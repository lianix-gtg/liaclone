// api/auth.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const db = require('./db');
const { isRateLimited } = require('./rateLimit');

const JWT_SECRET = process.env.JWT_SECRET || 'zuclone_super_secure_secret_key_123';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || '6LeIxAcTAAAAAGG-vFI1qgH_5tcZCc0hC12aa2qX'; // Test key bawaan Google

// Helper untuk parsing cookie
function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
}

// Helper untuk memverifikasi Google reCAPTCHA
async function verifyRecaptcha(token, ip) {
    if (!token) return false;
    try {
        const response = await axios.post(
            `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET}&response=${token}&remoteip=${ip}`
        );
        return response.data && response.data.success;
    } catch (err) {
        console.error('Error saat verifikasi reCAPTCHA:', err.message);
        return false;
    }
}

module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    // Ambil action (bisa dari query atau body)
    let action = req.query.action;
    if (!action && req.method === 'POST') {
        action = req.body && req.body.action;
    }

    if (!action) {
        return res.status(400).json({ error: 'Parameter action tidak ditentukan' });
    }

    // 1. CEK SESSION STATUS (action = me)
    if (action === 'me') {
        try {
            let token = '';
            // Ambil token dari header Authorization
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
            
            // Jika tidak ada di header, coba ambil dari Cookie
            if (!token) {
                const cookies = parseCookies(req.headers.cookie);
                token = cookies.token;
            }

            if (!token) {
                return res.status(200).json({ authenticated: false });
            }

            const decoded = jwt.verify(token, JWT_SECRET);
            return res.status(200).json({
                authenticated: true,
                user: {
                    username: decoded.username,
                    role: decoded.role
                }
            });
        } catch (err) {
            return res.status(200).json({ authenticated: false, error: 'Token tidak valid' });
        }
    }

    // 2. LOGOUT (action = logout)
    if (action === 'logout') {
        res.setHeader('Set-Cookie', 'token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict');
        if (req.method === 'POST' && req.body.username) {
            await db.logActivity(ip, 'logout', `User ${req.body.username} logged out`);
        }
        return res.status(200).json({ success: true, message: 'Berhasil logout' });
    }

    // Semua action lain wajib POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode HTTP tidak diizinkan' });
    }

    // Rate Limiting khusus Auth (Maksimal 10 request per menit per IP)
    if (isRateLimited(ip, 10, 60000)) {
        await db.logActivity(ip, 'rate_limit_exceeded_auth', `IP ${ip} diblokir sementara karena spam auth`);
        return res.status(429).json({ error: 'Terlalu banyak permintaan. Silakan coba lagi nanti.' });
    }

    // 3. REGISTER (action = register)
    if (action === 'register') {
        const { username, password, recaptchaToken } = req.body;

        // Validasi input
        if (!username || !password) {
            return res.status(400).json({ error: 'Username dan password wajib diisi' });
        }

        const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
        if (!usernameRegex.test(username)) {
            return res.status(400).json({ error: 'Username harus alfanumerik, panjang 3-20 karakter' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password minimal harus 6 karakter' });
        }

        // Verifikasi reCAPTCHA
        const isHuman = await verifyRecaptcha(recaptchaToken, ip);
        if (!isHuman) {
            await db.logActivity(ip, 'register_failed_recaptcha', `Username: ${username} gagal reCAPTCHA`);
            return res.status(400).json({ error: 'Verifikasi bot gagal. Silakan isi reCAPTCHA dengan benar.' });
        }

        try {
            // Cek apakah username sudah ada
            const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [username]);
            if (existingUser) {
                return res.status(400).json({ error: 'Username sudah digunakan' });
            }

            // Hashing password
            const saltRounds = 12;
            const hash = await bcrypt.hash(password, saltRounds);

            // Simpan user baru
            await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
            await db.logActivity(ip, 'register_success', `User baru terdaftar: ${username}`);

            return res.status(201).json({ success: true, message: 'Registrasi berhasil! Silakan masuk.' });
        } catch (err) {
            console.error('Error register:', err.message);
            return res.status(500).json({ error: 'Terjadi kesalahan sistem' });
        }
    }

    // 4. LOGIN (action = login)
    if (action === 'login') {
        const { username, password, recaptchaToken } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username dan password wajib diisi' });
        }

        // Verifikasi reCAPTCHA
        const isHuman = await verifyRecaptcha(recaptchaToken, ip);
        if (!isHuman) {
            await db.logActivity(ip, 'login_failed_recaptcha', `Username: ${username} gagal reCAPTCHA`);
            return res.status(400).json({ error: 'Verifikasi bot gagal. Silakan isi reCAPTCHA dengan benar.' });
        }

        try {
            // Dapatkan data user
            const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (!user) {
                await db.logActivity(ip, 'login_failed_notfound', `Username ${username} tidak ditemukan`);
                return res.status(401).json({ error: 'Username atau password salah' });
            }

            // Verifikasi password
            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) {
                await db.logActivity(ip, 'login_failed_badpass', `Username ${username} memasukkan password yang salah`);
                return res.status(401).json({ error: 'Username atau password salah' });
            }

            // Buat JWT Token
            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            // Simpan token di HTTP-Only Cookie untuk keamanan optimal
            res.setHeader(
                'Set-Cookie',
                `token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict; Secure`
            );

            await db.logActivity(ip, 'login_success', `User berhasil masuk: ${username}`);

            return res.status(200).json({
                success: true,
                message: 'Login berhasil!',
                token,
                user: {
                    username: user.username,
                    role: user.role
                }
            });
        } catch (err) {
            console.error('Error login:', err.message);
            return res.status(500).json({ error: 'Terjadi kesalahan sistem' });
        }
    }

    return res.status(400).json({ error: 'Action tidak dikenali' });
};
