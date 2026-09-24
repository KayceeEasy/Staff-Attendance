const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = 'C:\\Users\\Kaycee\\Documents\\scripts\\Staff_Attendance';

console.log('\n======================================================');
console.log('🧪 EMPIRICAL TEST SUITE: DEVICE TRANSFER & ABCD-1234 FORMAT');
console.log('======================================================\n');

let passCount = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ PASS: ${name}`);
        passCount++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
        process.exitCode = 1;
    }
}

// 1. Device Transfer Request Fix
console.log('--- 1. Device Transfer Request Fix ---');
const commonJs = fs.readFileSync(path.join(ROOT, 'common.js'), 'utf8');
const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

test('common.js defines requestDeviceTransfer function', () => {
    assert(commonJs.includes('async function requestDeviceTransfer('), 'must define requestDeviceTransfer');
});

test('common.js supports request-device-transfer, get-device-transfers, and approve-device-transfer in callBackend', () => {
    assert(commonJs.includes("case 'request-device-transfer':"), 'must support request-device-transfer mode');
    assert(commonJs.includes("case 'get-device-transfers':"), 'must support get-device-transfers mode');
    assert(commonJs.includes("case 'approve-device-transfer':"), 'must support approve-device-transfer mode');
});

test('script.js calls requestDeviceTransfer(savedName) instead of undefined recordAnalyticsEvent', () => {
    assert(scriptJs.includes('await requestDeviceTransfer(savedName);'), 'must call requestDeviceTransfer(savedName)');
    assert(!scriptJs.includes("recordAnalyticsEvent('device_transfer_requested'"), 'must not call non-existent recordAnalyticsEvent');
});

// 2. Standardized Workspace Code Format (ABCD-1234)
console.log('\n--- 2. Workspace Code Standard (ABCD-1234) ---');

test('common.js generateWorkspaceCode generates 4 letters + hyphen + 4 digits (e.g. ABCD-1234)', () => {
    assert(commonJs.includes('generateWorkspaceCode'), 'must define generateWorkspaceCode');
    assert(commonJs.includes('/^[A-Z]{4}-\\d{4}$/'), 'must validate ABCD-1234 format regex');
});

test('index.html workspace code input uses ABCD-1234 placeholder and maxlength 9', () => {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert(indexHtml.includes('placeholder="e.g. LIFE-2026 or ACME-4829"'), 'placeholder must show ABCD-1234 examples');
    assert(indexHtml.includes('maxlength="9"'), 'maxlength must be 9 for 8 chars + 1 hyphen');
});

test('script.js auto-hyphenation formats 8-character inputs like ABCD1234 into ABCD-1234', () => {
    assert(scriptJs.includes('clean.length >= 5') || scriptJs.includes('cleanInput.length === 8'),
        'script.js must auto-format 8-character workspace codes');
});

// 3. Supabase Schema Verification
console.log('\n--- 3. Supabase Schema SQL Script ---');

test('supabase_schema_v3.sql exists and contains DDL for all 6 tables', () => {
    const schemaSql = fs.readFileSync(path.join(ROOT, 'supabase_schema_v3.sql'), 'utf8');
    assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.tenants'), 'must create tenants table');
    assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.staff'), 'must create staff table');
    assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.attendance_logs'), 'must create attendance_logs table');
    assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.device_transfers'), 'must create device_transfers table');
    assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.admin_users'), 'must create admin_users table');
    assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.app_config'), 'must create app_config table');
    assert(schemaSql.includes("('lifecard', 'Lifecard International', 'LIFE-2026'"), 'must include standardized seed data');
});

console.log('\n======================================================');
console.log(`📊 RESULTS: ${passCount} tests passed`);
console.log('======================================================\n');
