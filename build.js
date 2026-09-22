const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const FILES_TO_COPY = [
    'index.html',
    'script.js',
    'style.css',
    'common.js',
    'version.js',
    'manifest.json',
    'sw.js',
    'robots.txt'
];

const DIRS_TO_COPY = [
    'admin',
    'super-admin',
    'onboard',
    'hybrid',
    'image'
];

function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

console.log('[BUILD] Preparing production dist folder for Cloudflare...');

if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

for (const file of FILES_TO_COPY) {
    const srcPath = path.join(ROOT, file);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(DIST, file));
    }
}

for (const dir of DIRS_TO_COPY) {
    const srcPath = path.join(ROOT, dir);
    if (fs.existsSync(srcPath)) {
        copyDir(srcPath, path.join(DIST, dir));
    }
}

console.log('✅ [BUILD] dist directory created successfully with zero node_modules!');
