const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.webapp': 'application/json',
    '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
    // Parse URL and strip query params
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let reqPath = decodeURIComponent(parsedUrl.pathname);

    // Redirect clean routes lacking trailing slash so relative paths resolve cleanly
    if (/^\/tenant\/[^\/]+$/.test(reqPath)) {
        res.writeHead(302, { 'Location': reqPath + '/' + parsedUrl.search });
        res.end();
        return;
    }
    if (/^\/tenant\/[^\/]+\/admin$/.test(reqPath)) {
        res.writeHead(302, { 'Location': reqPath + '/' + parsedUrl.search });
        res.end();
        return;
    }
    if (/^\/tenant\/[^\/]+\/hybrid$/.test(reqPath)) {
        res.writeHead(302, { 'Location': reqPath + '/' + parsedUrl.search });
        res.end();
        return;
    }

    let filePath;
    if (reqPath.startsWith('/tenant/')) {
        // Rewrite /tenant/:slug/* to the underlying application files
        const subPath = reqPath.replace(/^\/tenant\/[^\/]+/, '') || '/';
        if (subPath === '/' || subPath === '') {
            filePath = path.join(ROOT, 'index.html');
        } else if (subPath === '/admin/' || subPath === '/admin') {
            filePath = path.join(ROOT, 'admin', 'index.html');
        } else if (subPath === '/hybrid/' || subPath === '/hybrid') {
            filePath = path.join(ROOT, 'hybrid', 'index.html');
        } else {
            filePath = path.join(ROOT, subPath);
        }
    } else {
        filePath = path.join(ROOT, reqPath);
    }

    // Prevent path traversal
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    // Check if directory, serve index.html
    try {
        const stat = fs.existsSync(filePath) && fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }
    } catch (e) {}

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end(`404 Not Found: ${reqPath}`);
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`500 Internal Server Error: ${err.code}`);
            }
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        const headers = {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        };

        // Anti-Crawl & Noindex Security Headers on Admin & Super-Admin & Onboard routes
        if (reqPath.startsWith('/super-admin') || reqPath.startsWith('/admin') || reqPath.startsWith('/onboard')) {
            headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive, nosnippet';
        }

        res.writeHead(200, headers);
        res.end(content);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`[SERVER] Attendance Commercial Sandbox (v3.0.0) is LIVE!`);
    console.log(`======================================================`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Network: http://192.168.18.2:${PORT}`);
    console.log(`\nDirect Links:`);
    console.log(`  - Staff Portal:        http://localhost:${PORT}/`);
    console.log(`  - Admin Console:       http://localhost:${PORT}/admin/`);
    console.log(`  - Super Admin Fleet:   http://localhost:${PORT}/super-admin/`);
    console.log(`  - Tenant Onboarding:   http://localhost:${PORT}/onboard/`);
    console.log(`  - Hybrid Scheduler:    http://localhost:${PORT}/hybrid/?key=admin`);
    console.log(`======================================================\n`);
});
