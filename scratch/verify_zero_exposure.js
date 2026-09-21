const http = require('http');
const fs = require('fs');
const assert = require('assert');

function get(path) {
    return new Promise((resolve, reject) => {
        http.get('http://localhost:8080' + path, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        }).on('error', reject);
    });
}

async function runTests() {
    console.log('🧪 Starting Empirical Zero-Exposure & Super Admin Privacy Tests...\n');

    // Test 1: Fetch root index.html
    console.log('1. Testing Root (/) HTML for zero roster leakage...');
    const rootRes = await get('/');
    assert.strictEqual(rootRes.status, 200, 'Root should return 200 OK');

    const knownStaff = ['Ayomide', 'Blessingjoy', 'Deborah', 'Elizabeth', 'Esther', 'Ikechukwu', 'Julianah', 'Kenneth', 'Martha', 'Paschaline', 'Uche', 'Valentine'];
    for (const name of knownStaff) {
        assert(!rootRes.body.includes(`<option>${name}</option>`), `FAIL: Staff member "${name}" was leaked in root HTML <option>!`);
        assert(!rootRes.body.includes(`"${name}"`), `FAIL: Staff member "${name}" was leaked in root HTML string!`);
    }
    console.log('   ✅ PASS: Zero staff names leaked in index.html!');

    // Test 2: Check presence of Zero-Exposure Identity Markup in index.html
    console.log('2. Testing Zero-Exposure UI elements...');
    assert(rootRes.body.includes('id="linked-identity-card"'), 'Missing linked-identity-card element');
    assert(rootRes.body.includes('id="unlinked-entry-box"'), 'Missing unlinked-entry-box element');
    assert(rootRes.body.includes('id="staff-search-input"'), 'Missing staff-search-input element');
    assert(rootRes.body.includes('id="confirm-identity-btn"'), 'Missing confirm-identity-btn element');
    assert(rootRes.body.includes('id="switch-identity-btn"'), 'Missing switch-identity-btn element');
    console.log('   ✅ PASS: Zero-exposure UI elements verified!');

    // Test 3: Check Super Admin links scrubbed from public pages
    console.log('3. Testing that Super Admin links are scrubbed from public client pages...');
    assert(!rootRes.body.includes('/super-admin/'), 'Super admin link leaked in index.html!');
    
    const onboardRes = await get('/onboard/');
    assert.strictEqual(onboardRes.status, 200);
    assert(!onboardRes.body.includes('super-admin'), 'FAIL: super-admin found in onboard/index.html!');
    assert(!onboardRes.body.includes('Super Admin'), 'FAIL: "Super Admin" found in onboard/index.html!');
    console.log('   ✅ PASS: Super admin links completely scrubbed from onboarding page!');

    const adminJs = fs.readFileSync('admin/admin.js', 'utf8');
    assert(!adminJs.includes('super-admin'), 'FAIL: super-admin link found in admin/admin.js!');
    assert(!adminJs.includes('Super Admin Fleet'), 'FAIL: Super Admin Fleet found in admin/admin.js!');
    console.log('   ✅ PASS: Super admin links scrubbed from Admin Console UI!');

    // Test 4: Check Locked/Unlocked wording updated to Linked/Unlinked
    console.log('4. Testing wording in Admin Console...');
    assert(adminJs.includes('📱 Linked'), 'Missing "📱 Linked" status badge in admin.js');
    assert(adminJs.includes('Unlinked'), 'Missing "Unlinked" status badge in admin.js');
    assert(adminJs.includes('Device Link'), 'Missing "Device Link" header in admin.js');
    console.log('   ✅ PASS: Wording correctly updated to Linked/Unlinked!');

    // Test 5: Verify clean routing on /tenant/:slug/
    console.log('5. Testing Clean Routing on /tenant/acme/ ...');
    const tenantRes = await get('/tenant/acme/');
    assert.strictEqual(tenantRes.status, 200);
    for (const name of knownStaff) {
        assert(!tenantRes.body.includes(`<option>${name}</option>`), `FAIL: Staff member "${name}" was leaked in tenant HTML!`);
    }
    console.log('   ✅ PASS: /tenant/acme/ served cleanly with zero roster leakage!');

    // Test 6: Verify CSS for zero-exposure components
    console.log('6. Testing CSS styling definitions...');
    const styleCss = fs.readFileSync('style.css', 'utf8');
    assert(styleCss.includes('.linked-identity-card'), 'Missing .linked-identity-card in style.css');
    assert(styleCss.includes('.linked-avatar'), 'Missing .linked-avatar in style.css');
    assert(styleCss.includes('.btn-switch-identity'), 'Missing .btn-switch-identity in style.css');
    assert(styleCss.includes('.btn-confirm-identity'), 'Missing .btn-confirm-identity in style.css');
    console.log('   ✅ PASS: All required CSS styling rules present!');

    // Test 7: Verify robots.txt blocks crawlers and disallows super-admin
    console.log('7. Testing robots.txt...');
    const robotsRes = await get('/robots.txt');
    assert.strictEqual(robotsRes.status, 200);
    assert(robotsRes.body.includes('Disallow: /super-admin/'), 'robots.txt must disallow /super-admin/');
    console.log('   ✅ PASS: robots.txt properly configured!');

    console.log('\n🎉 ALL PRIVACY AND ZERO-EXPOSURE VERIFICATION CHECKS PASSED WITH ZERO ERRORS!\n');
}

runTests().catch(err => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
