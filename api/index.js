// api/index.js
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { isRateLimited } = require('./rateLimit');

const JWT_SECRET = process.env.JWT_SECRET || 'zuclone_super_secure_secret_key_123';

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

// Fungsi utama untuk kloning website
async function saveweb2zip(url, options = {}) {
    try {
        if (!url) throw new Error('Url is required');
        url = url.startsWith('https://') || url.startsWith('http://') ? url : `https://${url}`;
        
        const {
            renameAssets = false,
            saveStructure = false,
            alternativeAlgorithm = false,
            mobileVersion = false
        } = options;
        
        // Request inisiasi copy
        const { data } = await axios.post('https://copier.saveweb2zip.com/api/copySite', {
            url,
            renameAssets,
            saveStructure,
            alternativeAlgorithm,
            mobileVersion
        }, {
            headers: {
                accept: '*/*',
                'content-type': 'application/json',
                origin: 'https://saveweb2zip.com',
                referer: 'https://saveweb2zip.com/',
                'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
            }
        });
        
        // Polling status
        let attempts = 0;
        const maxAttempts = 55; // Perlindungan Vercel timeout (maksimal sekitar 60 detik total)

        while (attempts < maxAttempts) {
            const { data: process } = await axios.get(`https://copier.saveweb2zip.com/api/getStatus/${data.md5}`, {
                headers: {
                    accept: '*/*',
                    'content-type': 'application/json',
                    origin: 'https://saveweb2zip.com',
                    referer: 'https://saveweb2zip.com/',
                    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
                }
            });
            
            if (process.isFinished) {
                  return {
                     url,
                     error: {
                         text: process.errorText,
                         code: process.errorCode,
                     },
                     copiedFilesAmount: process.copiedFilesAmount,
                     downloadUrl: `https://copier.saveweb2zip.com/api/downloadArchive/${process.md5}`
                 };
            }
            
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error("Timeout: Proses kloning melebihi batas waktu serverless.");

    } catch (error) {
        throw error;
    }
}

// Handler untuk Vercel Serverless Function
module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    // 1. Verifikasi Authentication (JWT)
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else {
        const cookies = parseCookies(req.headers.cookie);
        token = cookies.token;
    }

    let decodedUser = null;
    if (token) {
        try {
            decodedUser = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            // Token kedaluwarsa atau salah, biarkan null
        }
    }

    if (!decodedUser) {
        await db.logActivity(ip, 'clone_denied_unauthenticated', 'Percobaan kloning tanpa otentikasi');
        return res.status(401).json({ error: 'Silakan masuk (Sign In) terlebih dahulu untuk menggunakan fitur kloning.' });
    }

    // 2. Rate Limiting Kloning (Maksimal 5 klon per 10 menit per IP)
    if (isRateLimited(ip, 5, 600000)) {
        await db.logActivity(ip, 'rate_limit_exceeded_clone', `User ${decodedUser.username} diblokir sementara karena spam kloning`);
        return res.status(429).json({ error: 'Batas limit kloning tercapai. Silakan tunggu beberapa menit.' });
    }

    try {
        const { url, options } = req.body;
        
        await db.logActivity(ip, 'clone_start', `User ${decodedUser.username} memulai kloning: ${url}`);
        
        const result = await saveweb2zip(url, options);

        if (result.error && result.error.code !== 0) {
            await db.logActivity(ip, 'clone_failed', `User ${decodedUser.username} gagal kloning: ${url}. Error: ${result.error.text}`);
        } else {
            await db.logActivity(ip, 'clone_success', `User ${decodedUser.username} berhasil kloning: ${url}. Jumlah file: ${result.copiedFilesAmount}`);
        }

        res.status(200).json(result);
    } catch (error) {
        await db.logActivity(ip, 'clone_error', `User ${decodedUser.username} mengalami kesalahan sistem saat kloning. Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};
