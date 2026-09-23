const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function analyzeFile(relPath) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) return;
    const content = fs.readFileSync(fullPath, 'utf8');

    console.log(`\n========================================`);
    console.log(`FILE ANALYSIS: ${relPath}`);
    console.log(`========================================`);

    // 1. Silent error catches: catch(e) {} or catch(e) { console.log(e); }
    const emptyCatchRegex = /catch\s*\([^\)]*\)\s*\{\s*\}/g;
    const emptyCatches = (content.match(emptyCatchRegex) || []).length;
    console.log(`- Empty catch blocks catch(e) {}: ${emptyCatches}`);

    // 2. Look for prompt() or alert() calls which provide degraded UX compared to custom dialogs/toasts
    const alertCalls = (content.match(/\balert\s*\(/g) || []).length;
    const confirmCalls = (content.match(/\bconfirm\s*\(/g) || []).length;
    const promptCalls = (content.match(/\bprompt\s*\(/g) || []).length;
    console.log(`- Native alert() calls: ${alertCalls}`);
    console.log(`- Native confirm() calls: ${confirmCalls}`);
    console.log(`- Native prompt() calls: ${promptCalls}`);

    // 3. Find missing error notifications in async functions
    const asyncFns = content.match(/async\s+function\s+([a-zA-Z0-9_$]+)/g) || [];
    console.log(`- Total async functions: ${asyncFns.length}`);

    // 4. Form inputs without disabled state during submit
    // 5. Look for any inline styles with z-index > 1000
    const highZ = content.match(/z-index\s*:\s*(\d+)/g) || [];
    const zSet = new Set(highZ);
    console.log(`- Distinct high z-indices: ${Array.from(zSet).join(', ')}`);
}

['common.js', 'script.js', 'admin/admin.js', 'super-admin/super_admin.js', 'onboard/onboard.js', 'hybrid/script.js'].forEach(analyzeFile);
