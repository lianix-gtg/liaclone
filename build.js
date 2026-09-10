// build.js
const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const htmlMinifier = require('html-minifier');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcDir = path.join(__dirname, 'src');
const destDir = path.join(__dirname, 'public');

// Pastikan folder tujuan exists
if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir);
}

console.log('Memulai proses build & kompilasi keamanan...');

// 1. Minifikasi CSS
try {
    console.log('Melakukan minifikasi CSS...');
    const cssContent = fs.readFileSync(path.join(srcDir, 'style.css'), 'utf8');
    const minifiedCss = new CleanCSS().minify(cssContent).styles;
    fs.writeFileSync(path.join(destDir, 'style.css'), minifiedCss, 'utf8');
    console.log('✓ CSS berhasil diminifikasi.');
} catch (err) {
    console.error('✗ Gagal meminifikasi CSS:', err.message);
}

// 2. Obfuscation & Minifikasi JS (Enterprise Obfuscator)
try {
    console.log('Melakukan obfuscation JavaScript...');
    const jsContent = fs.readFileSync(path.join(srcDir, 'script.js'), 'utf8');
    const obfuscatedJs = JavaScriptObfuscator.obfuscate(jsContent, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.6,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        debugProtection: true,
        debugProtectionInterval: 4000,
        disableConsoleOutput: false, // Agar watermark console keamanan kita tetap tampil
        numbersToExpressions: true,
        simplify: true,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayEncoding: ['rc4'],
        stringArrayThreshold: 0.8
    }).getObfuscatedCode();
    fs.writeFileSync(path.join(destDir, 'script.js'), obfuscatedJs, 'utf8');
    console.log('✓ JavaScript berhasil diobfuscate dan diminifikasi.');
} catch (err) {
    console.error('✗ Gagal mengobfuscate JS:', err.message);
}

// 3. Minifikasi HTML
try {
    console.log('Melakukan minifikasi HTML...');
    const htmlContent = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
    const minifiedHtml = htmlMinifier.minify(htmlContent, {
        collapseWhitespace: true,
        removeComments: true,
        minifyJS: true,
        minifyCSS: true
    });
    fs.writeFileSync(path.join(destDir, 'index.html'), minifiedHtml, 'utf8');
    console.log('✓ HTML berhasil diminifikasi.');
} catch (err) {
    console.error('✗ Gagal meminifikasi HTML:', err.message);
}

// 4. Salin file Aset (Gambar)
const assets = ['moon.png', 'zuclone.png', 'zuclone-no-bg.png'];
assets.forEach(asset => {
    try {
        const srcAssetPath = path.join(srcDir, asset);
        const destAssetPath = path.join(destDir, asset);
        if (fs.existsSync(srcAssetPath)) {
            fs.copyFileSync(srcAssetPath, destAssetPath);
            console.log(`✓ Aset disalin: ${asset}`);
        }
    } catch (err) {
        console.error(`✗ Gagal menyalin aset ${asset}:`, err.message);
    }
});

console.log('Proses build selesai dengan sukses!');
