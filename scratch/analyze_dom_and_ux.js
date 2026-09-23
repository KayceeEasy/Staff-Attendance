const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function checkPage(htmlRel, jsRels) {
    const htmlPath = path.join(ROOT, htmlRel);
    const html = fs.readFileSync(htmlPath, 'utf8');
    let jsCode = '';
    for (const j of jsRels) {
        const p = path.join(ROOT, j);
        if (fs.existsSync(p)) jsCode += fs.readFileSync(p, 'utf8') + '\n';
    }
    
    // Find all document.getElementById('...') in JS
    const regex = /getElementById\(['"]([a-zA-Z0-9_\-]+)['"]\)/g;
    let match;
    const idsInJs = new Set();
    while ((match = regex.exec(jsCode)) !== null) {
        idsInJs.add(match[1]);
    }
    
    const missing = [];
    for (const id of idsInJs) {
        const inHtml = html.includes('id="' + id + '"') || html.includes("id='" + id + "'") || html.includes('id=' + id);
        const inJs = jsCode.includes('id="' + id + '"') || jsCode.includes("id='" + id + "'");
        if (!inHtml && !inJs) {
            missing.push(id);
        }
    }
    console.log(htmlRel + ': ' + idsInJs.size + ' IDs queried in JS');
    if (missing.length) {
        console.log('  ⚠️ POTENTIALLY MISSING IDs (' + missing.length + '):', missing);
    } else {
        console.log('  ✅ All IDs accounted for.');
    }
}

console.log('--- AUDITING DOM ID BINDINGS ---');
checkPage('index.html', ['common.js', 'script.js']);
checkPage('admin/index.html', ['common.js', 'admin/admin.js']);
checkPage('super-admin/index.html', ['common.js', 'super-admin/super_admin.js']);
checkPage('onboard/index.html', ['common.js', 'onboard/onboard.js']);
checkPage('hybrid/index.html', ['hybrid/script.js']);
