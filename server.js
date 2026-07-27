import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SCRIPT_URL = process.env.GAS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwKXksPAcj-dar7BkC_lAoGsVM-aF0BT81lkgToafv0natBxpb1S8iI0KD8q0NJemwksw/exec';

// Security Headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"]
        }
    }
}));

// CORS configuration
app.use(cors());

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: '*/*', limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static frontend files from root directory
app.use(express.static(__dirname));

// Rate Limiting for API proxy (150 requests per 15 mins per IP)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150,
    message: { ok: false, message: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', apiLimiter);

// Allowed API modes whitelist
const ALLOWED_MODES = new Set([
    'attendance',
    'verify-owner',
    'register-owner',
    'reassign-owner',
    'list-staff',
    'add-staff',
    'remove-staff',
    'reset-staff-lock',
    'reset-all-locks',
    'list-logs',
    'get-hybrid-schedule',
    'get-config',
    'update-config',
    'admin-login',
    'admin-change-password',
    'admin-set-recovery-email',
    'admin-forgot-password-request',
    'admin-forgot-password-confirm',
    'get-sheet-url',
    'list-analytics',
    'list-distance-alerts',
    'list-audit-logs',
    'log-analytics',
    'list-admin-users',
    'add-admin-user',
    'remove-admin-user',
    'admin-reset-user-password',
    'get-recovery-email'
]);

app.post('/api/backend', async (req, res) => {
    try {
        let payload = req.body || {};
        if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch (e) { payload = {}; }
        }
        const mode = payload.mode;

        if (!mode || !ALLOWED_MODES.has(mode)) {
            return res.status(400).json({ ok: false, message: 'Invalid or disallowed API mode.' });
        }

        // Developer Superuser check — only 'Kaycee' account
        const superuserUsername = process.env.SUPERUSER_USERNAME || 'Kaycee';
        const superuserPassword = process.env.SUPERUSER_PASSWORD || 'Neon8888*#.';

        if (mode === 'admin-login' && payload.username && payload.username.toLowerCase() === superuserUsername.toLowerCase()) {
            const crypto = await import('crypto');
            const expectedHash = crypto.createHash('sha256').update(superuserPassword).digest('hex');
            if (payload.passwordHash === expectedHash) {
                const superuserCsrf = 'csrf_dev_' + Math.random().toString(36).slice(2);
                const superuserToken = 'token_dev_' + Math.random().toString(36).slice(2);
                return res.json({
                    ok: true,
                    allowed: true,
                    isSuperuser: true,
                    username: superuserUsername,
                    csrfToken: superuserCsrf,
                    adminToken: superuserToken,
                    message: '👑 Developer Superuser authenticated successfully.'
                });
            }
        }

        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
                'User-Agent': 'LifecardAttendanceProxy/1.0'
            },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });
        
        const text = await response.text();
        if (text.includes('SyntaxError') || text.includes('errorMessage') || text.startsWith('<!DOCTYPE')) {
            const match = text.match(/<div[^>]*>([^<]*SyntaxError[^<]*)<\/div>/i) || text.match(/(SyntaxError:[^<]+)/i);
            const errMsg = match ? match[1] : 'Google Apps Script returned an error HTML page.';
            return res.status(200).json({ ok: false, allowed: false, message: 'Google Apps Script Error: ' + errMsg });
        }

        try {
            const json = JSON.parse(text);
            return res.json(json.result || json);
        } catch (e) {
            const jsonpMatch = text.match(/^[a-zA-Z0-9_$]+\((.*)\);?$/s);
            if (jsonpMatch) {
                const inner = JSON.parse(jsonpMatch[1]);
                return res.json(inner.result || inner);
            }
            return res.status(200).json({ ok: false, message: 'Unexpected server response: ' + text.slice(0, 100) });
        }
    } catch (err) {
        return res.status(500).json({ ok: false, message: 'Proxy server error: ' + err.message });
    }
});

// Redirect root admin path if needed
app.get('/admin', (req, res) => {
    res.redirect('/admin/');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
