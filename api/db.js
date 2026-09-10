// api/db.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Tentukan lokasi database: /tmp/ jika di Vercel (read-only filesystem), atau root folder jika lokal
const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
const dbPath = isVercel 
    ? path.join('/tmp', 'database.sqlite')
    : path.join(__dirname, '..', 'database.sqlite');

// Membuka database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Gagal membuka database SQLite:', err.message);
    } else {
        console.log(`Database SQLite tersambung di: ${dbPath}`);
        initDb();
    }
});

// Fungsi inisialisasi tabel
function initDb() {
    db.serialize(() => {
        // Tabel Users
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error('Gagal membuat tabel users:', err.message);
        });

        // Tabel Activity Logs
        db.run(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error('Gagal membuat tabel activity_logs:', err.message);
        });
    });
}

// Promise wrapper untuk query run (INSERT, UPDATE, DELETE)
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve({ id: this.lastID, changes: this.changes });
            }
        });
    });
}

// Promise wrapper untuk query get (select single row)
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

// Promise wrapper untuk query all (select multiple rows)
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Fungsi helper untuk logging aktivitas secara aman menggunakan prepared statements
async function logActivity(ip, action, details) {
    try {
        await run(
            'INSERT INTO activity_logs (ip, action, details) VALUES (?, ?, ?)',
            [ip || '0.0.0.0', action, details || '']
        );
    } catch (err) {
        console.error('Gagal menyimpan log aktivitas:', err.message);
    }
}

module.exports = {
    db,
    run,
    get,
    all,
    logActivity
};
