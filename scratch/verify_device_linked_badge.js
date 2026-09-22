// Empirical Verification Script: Device Badge Changed from 'Bound' to 'Linked'
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- STARTING EMPIRICAL VERIFICATION: "BOUND" TO "LINKED" BADGE ---');

const ROOT_DIR = path.resolve(__dirname, '..');

// 1. Verify index.html badge markup
console.log('\n[TEST 1] Verifying index.html device pill text...');
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

const pillMatch = indexHtml.match(/<span class="device-locked-pill"[^>]*>([\s\S]*?)<\/span><\/span>/);
assert(pillMatch, 'index.html must contain .device-locked-pill');
const pillContent = pillMatch[0];

assert(pillContent.includes('Linked'), 'Pill content must contain "Linked" text');
assert(!pillContent.includes('>Bound<'), 'Pill content must NOT contain ">Bound<" text');
assert(pillContent.includes('data-i18n="deviceBound"'), 'Pill must bind data-i18n="deviceBound"');
assert(pillContent.includes('Device securely linked to your employee profile'), 'Tooltip must reflect linked state');

console.log('✅ PASS: index.html markup displays "Linked" instead of "Bound".');

// 2. Verify common.js dictionary translations
console.log('\n[TEST 2] Verifying common.js i18n dictionaries for deviceBound...');
const commonJs = fs.readFileSync(path.join(ROOT_DIR, 'common.js'), 'utf8');

assert(commonJs.includes('deviceBound: "Linked"'), 'common.js English dictionary must map deviceBound to "Linked"');
assert(commonJs.includes('deviceBound: "Lié"'), 'common.js French dictionary must map deviceBound to "Lié"');
assert(commonJs.includes('deviceBound: "مرتبط"'), 'common.js Arabic dictionary must map deviceBound to "مرتبط"');

console.log('✅ PASS: common.js dictionaries accurately map deviceBound to "Linked" across languages.');

// 3. Verify admin.js CSV Export Status
console.log('\n[TEST 3] Verifying admin.js export status...');
const adminJs = fs.readFileSync(path.join(ROOT_DIR, 'admin', 'admin.js'), 'utf8');
assert(adminJs.includes("'Device Status': (s.device_id || s.deviceId) ? 'Linked' : 'Unlinked'"),
    'admin.js must report device status as "Linked" instead of "Bound / Linked"');

console.log('✅ PASS: admin.js export status matches "Linked".');

console.log('\n======================================================');
console.log('🎉 ALL "BOUND" TO "LINKED" CHECKS PASSED (3/3)!');
console.log('======================================================\n');
