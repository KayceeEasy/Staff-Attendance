const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const pages = [
    { name: 'Employee Portal', html: 'index.html', js: ['version.js', 'common.js', 'script.js'] },
    { name: 'Admin Console', html: 'admin/index.html', js: ['version.js', 'common.js', 'admin/admin.js'] },
    { name: 'Super Admin Console', html: 'super-admin/index.html', js: ['version.js', 'common.js', 'super-admin/super_admin.js'] },
    { name: 'Self-Serve Onboarding', html: 'onboard/index.html', js: ['version.js', 'common.js', 'onboard/onboard.js'] },
    { name: 'Hybrid Matrix Scheduler', html: 'hybrid/index.html', js: ['version.js', 'common.js', 'hybrid/script.js'] }
];

console.log('=== COMPREHENSIVE PROJECT AUDIT ===\n');

// 1. Check all HTML onclick/onchange/onsubmit handlers against JS functions
console.log('--- 1. AUDITING INLINE EVENT HANDLERS ---');
pages.forEach(page => {
    const htmlPath = path.join(ROOT, page.html);
    if (!fs.existsSync(htmlPath)) return;
    const html = fs.readFileSync(htmlPath, 'utf8');

    let allJs = '';
    page.js.forEach(j => {
        const p = path.join(ROOT, j);
        if (fs.existsSync(p)) allJs += fs.readFileSync(p, 'utf8') + '\n';
    });

    const handlerRegex = /on(click|change|submit|input|keydown|keyup)=["']([^"']+)["']/gi;
    let m;
    const missingHandlers = [];
    const foundHandlers = [];
    while ((m = handlerRegex.exec(html)) !== null) {
        const fullExpr = m[2].trim();
        // Extract function name, e.g. "submitTenantOnboarding()", "switchTab('overview')", "window.print()"
        const fnMatch = fullExpr.match(/^([a-zA-Z0-9_$]+)\s*\(/);
        if (fnMatch) {
            const fnName = fnMatch[1];
            // Skip standard built-ins
            if (['window', 'alert', 'confirm', 'console', 'history', 'event'].includes(fnName)) continue;
            // Check if function defined in JS
            const fnDefRegex = new RegExp(`(function\\s+${fnName}\\b|const\\s+${fnName}\\s*=|let\\s+${fnName}\\s*=|var\\s+${fnName}\\s*=|window\\.${fnName}\\s*=)`);
            if (!fnDefRegex.test(allJs)) {
                missingHandlers.push({ expr: fullExpr, fn: fnName, event: m[1] });
            } else {
                foundHandlers.push(fnName);
            }
        }
    }
    console.log(`[${page.name}] (${page.html}):`);
    if (missingHandlers.length > 0) {
        console.log(`  ❌ Missing Handler Functions (${missingHandlers.length}):`, missingHandlers);
    } else {
        console.log(`  ✅ All inline handlers defined (${foundHandlers.length} checked).`);
    }
});

// 2. Check for dead buttons (buttons without id, class for JS, onclick, or form submit type)
console.log('\n--- 2. AUDITING BUTTONS (DEAD BUTTON DETECTION) ---');
pages.forEach(page => {
    const htmlPath = path.join(ROOT, page.html);
    if (!fs.existsSync(htmlPath)) return;
    const html = fs.readFileSync(htmlPath, 'utf8');
    let allJs = '';
    page.js.forEach(j => {
        const p = path.join(ROOT, j);
        if (fs.existsSync(p)) allJs += fs.readFileSync(p, 'utf8') + '\n';
    });

    const btnRegex = /<button\b([^>]*)>(.*?)<\/button>/gis;
    let bMatch;
    const deadButtons = [];
    while ((bMatch = btnRegex.exec(html)) !== null) {
        const attrs = bMatch[1];
        const label = bMatch[2].replace(/<[^>]+>/g, '').trim() || '[Icon/Empty]';
        const hasOnClick = /onclick=/i.test(attrs);
        const hasTypeSubmit = /type=["']submit["']/i.test(attrs);
        const idMatch = attrs.match(/id=["']([^"']+)["']/i);
        const classMatch = attrs.match(/class=["']([^"']+)["']/i);

        let isHandled = hasOnClick || hasTypeSubmit;
        if (!isHandled && idMatch) {
            const id = idMatch[1];
            // Check if id referenced in JS
            if (allJs.includes(`'${id}'`) || allJs.includes(`"${id}"`)) {
                isHandled = true;
            }
        }
        if (!isHandled && classMatch) {
            const classes = classMatch[1].split(/\s+/);
            for (const c of classes) {
                if (allJs.includes(`'.${c}'`) || allJs.includes(`".${c}"`)) {
                    isHandled = true;
                    break;
                }
            }
        }
        if (!isHandled) {
            deadButtons.push({ label, attrs: attrs.trim() });
        }
    }
    console.log(`[${page.name}] (${page.html}):`);
    if (deadButtons.length > 0) {
        console.log(`  ⚠️ Potentially Unwired Buttons (${deadButtons.length}):`, deadButtons);
    } else {
        console.log(`  ✅ All buttons wired up.`);
    }
});

// 3. Check for Hardcoded Legacy Data / Names across all JS
console.log('\n--- 3. CHECKING HARDCODED STRINGS & LEGACY ARTIFACTS ---');
const suspiciousPatterns = [
    { label: 'Hardcoded legacy client "Lifecard"', pattern: /lifecard/i },
    { label: 'Hardcoded legacy staff "Blessingjoy"', pattern: /blessingjoy/i },
    { label: 'Localhost / loopback URLs', pattern: /http:\/\/(localhost|127\.0\.0\.1):/i },
    { label: 'Placeholder / TODO comments', pattern: /\/\/\s*(TODO|FIXME|XXX|HACK)\b/i }
];

const jsFiles = [
    'common.js', 'script.js', 'admin/admin.js', 'super-admin/super_admin.js',
    'onboard/onboard.js', 'hybrid/script.js'
];

jsFiles.forEach(file => {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) return;
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.split('\n');

    suspiciousPatterns.forEach(sp => {
        const matches = [];
        lines.forEach((line, idx) => {
            if (sp.pattern.test(line)) {
                matches.push({ line: idx + 1, text: line.trim() });
            }
        });
        if (matches.length > 0) {
            console.log(`  🔍 [${file}] ${sp.label} found on ${matches.length} line(s):`);
            matches.slice(0, 5).forEach(m => console.log(`      L${m.line}: ${m.text.substring(0, 100)}`));
            if (matches.length > 5) console.log(`      ... and ${matches.length - 5} more.`);
        }
    });
});
