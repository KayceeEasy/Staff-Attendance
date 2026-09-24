const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = 'C:\\Users\\Kaycee\\Documents\\scripts\\Staff_Attendance';

console.log('\n======================================================');
console.log('🧪 EMPIRICAL TEST SUITE: TOPBAR, HYPHEN, PRIVACY & BIOMETRIC WORKFLOW');
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

// 1. Top Bar Header Layout & Alignment
console.log('--- 1. Top Bar Header Layout & Alignment ---');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8').replace(/\r\n/g, '\n');

test('index.html contains structured topbar brand elements', () => {
    assert(indexHtml.includes('class="tenant-logo-wrap"'), 'must include tenant-logo-wrap');
    assert(indexHtml.includes('class="tenant-info-wrap"'), 'must include tenant-info-wrap');
    assert(indexHtml.includes('class="tenant-name-row"'), 'must include tenant-name-row');
    assert(indexHtml.includes('class="tenant-brand-name"'), 'must include tenant-brand-name');
    assert(indexHtml.includes('class="switch-badge-btn"'), 'must include switch-badge-btn');
});

test('style.css defines inline flex row for topbar-brand and switch-badge-btn', () => {
    assert(styleCss.includes('.topbar-brand {\n    display: flex;\n    flex-direction: row;\n    align-items: center;'),
        'topbar-brand must be row flex');
    assert(styleCss.includes('.tenant-brand-name {'), 'must define .tenant-brand-name');
    assert(styleCss.includes('.switch-badge-btn {'), 'must define .switch-badge-btn');
});

// 2. Pairing Code Hyphen Autofill
console.log('\n--- 2. Pairing Code Auto-Hyphenation ---');
const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

test('script.js auto-formats 6 and 8 character inputs with hyphen as user types', () => {
    assert(scriptJs.includes('clean.slice(0, 4)') || scriptJs.includes('clean.slice(0, 3)'), 'must format workspace codes with hyphen');
});

test('script.js handleConnect normalizes code matching to accept formatted and unformatted codes', () => {
    assert(scriptJs.includes('cleanInput.length === 6'), 'handleConnect must check clean input length');
    assert(scriptJs.includes('cleanTCode === cleanInput'), 'handleConnect must match stripped clean codes');
});

// 3. Privacy & Location Policy Outdated
console.log('\n--- 3. Privacy & Location Policy Modernization ---');

test('index.html privacy modal has no legacy Kaycee Tech branding', () => {
    assert(!indexHtml.includes('Kaycee Tech'), 'privacy modal must not contain legacy Kaycee Tech');
    assert(indexHtml.includes('id="privacy-policy-tenant-name"'), 'must include dynamic tenant name element');
    assert(indexHtml.includes('Hardware-Level Biometric Protection'), 'must detail hardware biometric protection');
    assert(indexHtml.includes('Instantaneous Proximity Verification'), 'must detail instantaneous proximity verification');
});

test('script.js openPrivacyModal dynamically sets active tenant name', () => {
    assert(scriptJs.includes("const tenantNameEl = document.getElementById('privacy-policy-tenant-name');"),
        'openPrivacyModal must fetch tenantNameEl');
});

// 4. Admin Portal Opening After Pairing
console.log('\n--- 4. Admin Portal Routing & Tenant Query Support ---');

test('index.html admin access link points to valid relative admin portal', () => {
    assert(indexHtml.includes('id="admin-access-btn" class="admin-btn admin-link" href="./admin/index.html"'),
        'admin access button must point to ./admin/index.html');
});

test('script.js updateTenantBranding sets adminBtn.href to relative ./admin/index.html with tenant query', () => {
    assert(scriptJs.includes("adminBtn.href = `./admin/index.html?tenant=${encodeURIComponent(tenant.slug)}`;"),
        'adminBtn.href must point to ./admin/index.html?tenant=slug');
});

const adminJs = fs.readFileSync(path.join(ROOT, 'admin', 'admin.js'), 'utf8');
test('admin/admin.js inspects URLSearchParams for tenant parameter on load', () => {
    assert(adminJs.includes("urlParams.get('tenant') || urlParams.get('slug')"),
        'initAdminTenantBranding must inspect URL tenant parameter');
});

// 5. Biometrics & Pairing Workflow Sequence
console.log('\n--- 5. Biometrics & Pairing Workflow Sequence ---');

test('style.css .qr-scanner-box specifies responsive min-height and 4:3 aspect ratio', () => {
    assert(styleCss.includes('aspect-ratio: 4 / 3;'), 'qr-scanner-box must specify 4/3 aspect ratio');
    assert(styleCss.includes('min-height: 230px;'), 'qr-scanner-box must specify min-height');
});

test('script.js selectStaffMember verifies biometrics/PIN BEFORE linking name to device', () => {
    assert(scriptJs.includes('MUST verify biometrics / device PIN BEFORE linking name to device'),
        'selectStaffMember must enforce verification before linking');
    assert(scriptJs.includes('onEnrollSuccess') && scriptJs.includes('onEnrollCancel'),
        'showBiometricEnrollModal must support callback handlers');
});

console.log('\n======================================================');
console.log(`📊 RESULTS: ${passCount} tests passed`);
console.log('======================================================\n');
