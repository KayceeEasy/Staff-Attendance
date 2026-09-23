const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function auditCSS() {
    const cssPath = path.join(ROOT, 'style.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    console.log('--- CSS AUDIT ---');
    // Check for hardcoded widths > 360px that are not inside media queries
    const lines = css.split('\n');
    let insideMediaQuery = false;
    const overflowRisks = [];
    lines.forEach((line, idx) => {
        if (line.includes('@media')) insideMediaQuery = true;
        if (insideMediaQuery && line.includes('}')) {
            // naive check, but let's look for width: > 360px
        }
        const widthMatch = line.match(/(?:min-width|width):\s*(\d+)px/);
        if (widthMatch) {
            const w = parseInt(widthMatch[1], 10);
            if (w > 360 && !line.includes('max-width') && !line.includes('calc')) {
                overflowRisks.push({ line: idx + 1, text: line.trim() });
            }
        }
    });
    console.log(`Found ${overflowRisks.length} potentially rigid pixel widths > 360px:`);
    overflowRisks.slice(0, 10).forEach(r => console.log(`  L${r.line}: ${r.text}`));
    if (overflowRisks.length > 10) console.log(`  ... and ${overflowRisks.length - 10} more.`);
}

function auditAccessibility() {
    console.log('\n--- ACCESSIBILITY & FORM AUDIT ---');
    const htmlFiles = [
        'index.html', 'admin/index.html', 'super-admin/index.html',
        'onboard/index.html', 'hybrid/index.html'
    ];

    htmlFiles.forEach(file => {
        const filePath = path.join(ROOT, file);
        if (!fs.existsSync(filePath)) return;
        const html = fs.readFileSync(filePath, 'utf8');

        // Check for inputs without label or aria-label
        const inputRegex = /<input\b([^>]*)>/gi;
        let m;
        const unlabelledInputs = [];
        while ((m = inputRegex.exec(html)) !== null) {
            const attrs = m[1];
            if (attrs.includes('type="hidden"')) continue;
            const hasAria = attrs.includes('aria-label') || attrs.includes('aria-labelledby');
            const hasId = attrs.match(/id=["']([^"']+)["']/);
            let hasLabel = false;
            if (hasId) {
                const id = hasId[1];
                if (html.includes(`for="${id}"`) || html.includes(`for='${id}'`)) {
                    hasLabel = true;
                }
            }
            if (!hasAria && !hasLabel) {
                const id = hasId ? hasId[1] : '[no-id]';
                const type = (attrs.match(/type=["']([^"']+)["']/) || ['', 'text'])[1];
                unlabelledInputs.push({ id, type, attrs: attrs.trim() });
            }
        }

        // Check for buttons without text or aria-label
        const btnRegex = /<button\b([^>]*)>(.*?)<\/button>/gis;
        const unlabelledButtons = [];
        while ((m = btnRegex.exec(html)) !== null) {
            const attrs = m[1];
            const content = m[2].replace(/<[^>]+>/g, '').trim();
            const hasAria = attrs.includes('aria-label') || attrs.includes('title');
            if (!content && !hasAria) {
                unlabelledButtons.push(attrs.trim());
            }
        }

        console.log(`[${file}]:`);
        console.log(`  Unlabelled inputs: ${unlabelledInputs.length}`);
        if (unlabelledInputs.length > 0) {
            unlabelledInputs.forEach(i => console.log(`    - ID: ${i.id} (type: ${i.type})`));
        }
        console.log(`  Unlabelled buttons (icon-only without aria-label/title): ${unlabelledButtons.length}`);
        if (unlabelledButtons.length > 0) {
            unlabelledButtons.forEach(b => console.log(`    - ${b}`));
        }
    });
}

function auditModalsAndOverlays() {
    console.log('\n--- MODAL & OVERLAY UX AUDIT ---');
    const htmlFiles = ['index.html', 'admin/index.html', 'super-admin/index.html', 'onboard/index.html', 'hybrid/index.html'];
    htmlFiles.forEach(file => {
        const filePath = path.join(ROOT, file);
        if (!fs.existsSync(filePath)) return;
        const html = fs.readFileSync(filePath, 'utf8');

        // Find modal containers
        const modalRegex = /class=["'][^"']*\b(modal|dialog|overlay|drawer)\b[^"']*["'][^>]*id=["']([^"']+)["']/gi;
        let m;
        const modals = [];
        while ((m = modalRegex.exec(html)) !== null) {
            modals.push(m[2]);
        }
        console.log(`[${file}] Modals discovered (${modals.length}):`, modals);
    });
}

auditCSS();
auditAccessibility();
auditModalsAndOverlays();
