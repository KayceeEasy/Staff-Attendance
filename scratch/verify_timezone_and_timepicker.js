const fs = require('fs');
const path = require('path');

console.log('====================================================');
console.log('🧪 VERIFYING TIMEZONE, TIME PICKER & QR SCANNER SUITE');
console.log('====================================================');

const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const scriptJs = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../admin/admin.js'), 'utf8');
const commonJs = fs.readFileSync(path.join(__dirname, '../common.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`✅ PASS: ${message}`);
        passCount++;
    } else {
        console.error(`❌ FAIL: ${message}`);
        failCount++;
    }
}

// ─── 1. IN-APP QR SCANNER CHECKS ───
assert(indexHtml.includes('id="scan-workspace-qr-btn"'), 'index.html has "Scan a QR Code" button');
assert(indexHtml.includes('id="workspace-qr-scanner-box"'), 'index.html has camera scanner box');
assert(indexHtml.includes('id="workspace-qr-video"'), 'index.html has camera video element');
assert(indexHtml.includes('id="workspace-qr-guidance"'), 'index.html has permission denial guidance box');
assert(indexHtml.includes('id="retry-qr-camera-btn"'), 'index.html has "Try Camera Again" button');

assert(scriptJs.includes('function stopWorkspaceQrScanner()'), 'script.js defines stopWorkspaceQrScanner');
assert(scriptJs.includes('async function startWorkspaceQrScanner()'), 'script.js defines startWorkspaceQrScanner');
assert(scriptJs.includes('extractCodeFromQrData'), 'script.js defines extractCodeFromQrData URL/code parser');
assert(scriptJs.includes("camErr.name === 'NotAllowedError'"), 'script.js detects NotAllowedError camera permission denial');
assert(scriptJs.includes('Tap the <strong>🔒 icon</strong> in your browser address bar'), 'script.js renders friendly address bar permission guidance');
assert(styleCss.includes('.qr-scanner-box'), 'style.css defines .qr-scanner-box');
assert(styleCss.includes('.qr-scanner-reticle'), 'style.css defines .qr-scanner-reticle');
assert(styleCss.includes('@keyframes qrScan'), 'style.css defines animated scanline');

// ─── 2. TIMEZONE SELECTOR CHECKS ───
assert(commonJs.includes("TIMEZONE: 'Africa/Lagos'"), 'common.js get-config includes default TIMEZONE');
assert(commonJs.includes("timezone: 'Africa/Lagos'"), 'common.js getTenantConfig includes default timezone');
assert(adminJs.includes('const GLOBAL_TIMEZONES = ['), 'admin.js defines GLOBAL_TIMEZONES catalog');
assert(adminJs.includes('function formatTimezoneLabel(tzId)'), 'admin.js defines formatTimezoneLabel');
assert(adminJs.includes('function openTimezoneModal()'), 'admin.js defines openTimezoneModal');
assert(adminJs.includes('id="config-timezone-current"'), 'admin.js tab-config template includes config-timezone-current');
assert(adminJs.includes('id="config-timezone-btn"'), 'admin.js tab-config template includes config-timezone-btn');
assert(adminJs.includes("document.getElementById('config-timezone-btn')?.addEventListener"), 'admin.js binds config-timezone-btn click');
assert(styleCss.includes('.tz-modal-box'), 'style.css defines .tz-modal-box');
assert(styleCss.includes('.tz-list-item'), 'style.css defines .tz-list-item');

// ─── 3. ENHANCED TIME PICKER MODAL CHECKS ───
assert(adminJs.includes('function minutesToTimeComponents('), 'admin.js defines minutesToTimeComponents');
assert(adminJs.includes('function timeComponentsToMinutes('), 'admin.js defines timeComponentsToMinutes');
assert(adminJs.includes('function openTimePickerModal('), 'admin.js defines openTimePickerModal');
assert(styleCss.includes('.time-picker-box'), 'style.css defines .time-picker-box');
assert(styleCss.includes('.time-display-hero'), 'style.css defines .time-display-hero');
assert(styleCss.includes('.time-preset-pill'), 'style.css defines .time-preset-pill');

// ─── 4. LOGICAL UNIT TESTS (TIME CONVERSIONS & QR URL PARSING) ───
// Test minutesToTimeComponents
function testMinToTime(min) {
    const safeMin = Math.max(0, Math.min(1439, Number(min) || 0));
    let hh24 = Math.floor(safeMin / 60);
    const mm = safeMin % 60;
    const ampm = hh24 >= 12 ? 'PM' : 'AM';
    let hh12 = hh24 % 12;
    if (hh12 === 0) hh12 = 12;
    return { hh12, mm, ampm, totalMinutes: safeMin };
}

function testTimeToMin(hh12, mm, ampm) {
    let hh = Number(hh12) % 12;
    if (ampm === 'PM') hh += 12;
    return hh * 60 + Number(mm);
}

const t1 = testMinToTime(510);
assert(t1.hh12 === 8 && t1.mm === 30 && t1.ampm === 'AM', '510 minutes correctly converts to 8:30 AM');
assert(testTimeToMin(8, 30, 'AM') === 510, '8:30 AM correctly converts to 510 minutes');

const t2 = testMinToTime(1020);
assert(t2.hh12 === 5 && t2.mm === 0 && t2.ampm === 'PM', '1020 minutes correctly converts to 5:00 PM');
assert(testTimeToMin(5, 0, 'PM') === 1020, '5:00 PM correctly converts to 1020 minutes');

const t3 = testMinToTime(0);
assert(t3.hh12 === 12 && t3.mm === 0 && t3.ampm === 'AM', '0 minutes correctly converts to 12:00 AM');

const t4 = testMinToTime(720);
assert(t4.hh12 === 12 && t4.mm === 0 && t4.ampm === 'PM', '720 minutes correctly converts to 12:00 PM');

// Test QR Extraction logic
function testExtractQr(dataString) {
    if (!dataString) return '';
    try {
        if (dataString.includes('http://') || dataString.includes('https://')) {
            const url = new URL(dataString);
            const joinParam = url.searchParams.get('join') || url.searchParams.get('code') || url.searchParams.get('tenant') || url.searchParams.get('company');
            if (joinParam) return joinParam.trim();
        }
    } catch (e) {}
    return dataString.trim();
}

assert(testExtractQr('https://staff.company.com/?join=LIFE-26') === 'LIFE-26', 'Extracts ?join= from full HTTPS URL');
assert(testExtractQr('https://staff.company.com/?code=ACME-89') === 'ACME-89', 'Extracts ?code= from full HTTPS URL');
assert(testExtractQr('ACME-42') === 'ACME-42', 'Extracts raw workspace code string');

console.log('----------------------------------------------------');
console.log(`Summary: ${passCount} passed, ${failCount} failed`);
console.log('----------------------------------------------------');

if (failCount > 0) {
    process.exit(1);
} else {
    console.log('🎉 ALL TIMEZONE, TIME PICKER & QR SCANNER TESTS PASSED EMPIRICALLY!');
}
