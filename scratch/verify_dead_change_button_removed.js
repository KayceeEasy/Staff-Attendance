const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- EMPIRICAL TEST: REMOVAL OF DEAD "CHANGE" BUTTON ---');

const repoRoot = path.resolve(__dirname, '..');

// 1. Verify index.html
console.log('[Test 1] Checking index.html markup...');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
assert(!indexHtml.includes('id="switch-identity-btn"'), 'index.html must NOT contain dead switch-identity-btn element');
assert(!indexHtml.includes('btn-switch-identity'), 'index.html must NOT contain btn-switch-identity class');
assert(indexHtml.includes('class="device-locked-pill"'), 'index.html must retain device-locked-pill');
assert(indexHtml.includes('Contact your administrator to transfer or reset.'), 'device-locked-pill must have clear, honest tooltip');
console.log('✓ index.html successfully verified: Dead button completely removed, honest security tooltip in place.');

// 2. Verify script.js
console.log('[Test 2] Checking script.js logic...');
const scriptJs = fs.readFileSync(path.join(repoRoot, 'script.js'), 'utf8');
assert(!scriptJs.includes("getElementById('switch-identity-btn')"), 'script.js must NOT query for switch-identity-btn');
assert(!scriptJs.includes('handleUnlinkStaff'), 'script.js must NOT contain dead handleUnlinkStaff function');
assert(scriptJs.includes('res.is_linked === false'), 'script.js must retain remote administrator unlinking handler');
console.log('✓ script.js successfully verified: Zero dead handlers, remote admin unlinking preserved.');

console.log('\n>>> ALL DEAD BUTTON ELIMINATION TESTS PASSED (2/2) <<<');
