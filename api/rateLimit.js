// api/rateLimit.js
const ipRequests = new Map();

// Membersihkan data IP yang sudah lama tidak aktif secara berkala untuk menghindari memory leak
setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of ipRequests.entries()) {
        const active = timestamps.filter(time => now - time < 3600000); // 1 jam window maksimum
        if (active.length === 0) {
            ipRequests.delete(ip);
        } else {
            ipRequests.set(ip, active);
        }
    }
}, 600000); // Bersihkan setiap 10 menit

/**
 * Memeriksa apakah IP melebihi batas request
 * @param {string} ip - IP client
 * @param {number} limit - Jumlah maksimal request yang diizinkan dalam window
 * @param {number} windowMs - Durasi window dalam milidetik
 * @returns {boolean} true jika terkena rate limit, false jika aman
 */
function isRateLimited(ip, limit = 60, windowMs = 60000) {
    const now = Date.now();
    if (!ipRequests.has(ip)) {
        ipRequests.set(ip, []);
    }
    
    const timestamps = ipRequests.get(ip);
    // Filter timestamps yang berada dalam rentang windowMs
    const activeTimestamps = timestamps.filter(time => now - time < windowMs);
    
    if (activeTimestamps.length >= limit) {
        return true;
    }
    
    activeTimestamps.push(now);
    ipRequests.set(ip, activeTimestamps);
    return false;
}

module.exports = { isRateLimited };
