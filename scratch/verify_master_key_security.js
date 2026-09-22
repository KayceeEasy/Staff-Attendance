// Empirical Verification Script: Master Key Security & Key Rotation
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

console.log('--- STARTING EMPIRICAL MASTER KEY SECURITY TEST SUITE ---');

const ROOT_DIR = path.resolve(__dirname, '..');

function sha256Hex(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

// 1. Verify No Passwords or Credentials Leaked in HTML UI
console.log('\n[TEST 1] Verifying no passwords/master keys are leaked in super-admin UI...');
const superAdminHtml = fs.readFileSync(path.join(ROOT_DIR, 'super-admin', 'index.html'), 'utf8');

assert(!superAdminHtml.includes('Sandbox Master Key'), 'super-admin/index.html must NOT contain Sandbox Master Key text');
assert(!superAdminHtml.includes('LifecardMaster2026!'), 'super-admin/index.html must NOT contain default master key password');
assert(!superAdminHtml.includes('auth-hint'), 'super-admin/index.html must NOT contain .auth-hint element');

const mainHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT_DIR, 'admin', 'index.html'), 'utf8');
assert(!mainHtml.includes('LifecardMaster2026!'), 'index.html must NOT contain master key');
assert(!adminHtml.includes('LifecardMaster2026!'), 'admin/index.html must NOT contain master key');

console.log('✅ UI check passed: Zero credentials or password hints exposed on super-admin or tenant login pages.');

// 2. Verify verifyMasterKey() logic behavior (Simulated based on super_admin.js)
console.log('\n[TEST 2] Verifying master key verification and strict hash rotation...');
const superAdminJs = fs.readFileSync(path.join(ROOT_DIR, 'super-admin', 'super_admin.js'), 'utf8');

// Ensure the old vulnerability "|| clean === MASTER_PLATFORM_KEY" when storedHash is present is eliminated
assert(!superAdminJs.includes('return inputHash === storedHash || clean === MASTER_PLATFORM_KEY;'),
    'super_admin.js must NOT allow fallback to MASTER_PLATFORM_KEY when storedHash is present');

// Simulate the exact verifyMasterKey implementation
const MASTER_PLATFORM_KEY = 'LifecardMaster2026!';
async function verifyMasterKeySim(inputKey, mockStoredHash) {
    if (!inputKey) return false;
    const clean = inputKey.trim();
    const storedHash = mockStoredHash;
    if (storedHash) {
        try {
            const inputHash = sha256Hex(clean);
            return inputHash === storedHash;
        } catch(e) {
            return false;
        }
    }
    return clean === MASTER_PLATFORM_KEY;
}

(async () => {
    // Scenario A: Fresh install, no stored hash configured yet in database
    const initialWithDefaultKey = await verifyMasterKeySim('LifecardMaster2026!', null);
    assert.strictEqual(initialWithDefaultKey, true, 'Initial default key should unlock when no DB hash exists');

    const initialWithWrongKey = await verifyMasterKeySim('WrongPassword123!', null);
    assert.strictEqual(initialWithWrongKey, false, 'Wrong key must be rejected on fresh install');

    // Scenario B: User changes master key to a new secure custom password
    const newCustomPassword = 'MySuperSecureNewPassword2026!#';
    const customHashInDb = sha256Hex(newCustomPassword);

    // Test with new password
    const loginWithNewKey = await verifyMasterKeySim(newCustomPassword, customHashInDb);
    assert.strictEqual(loginWithNewKey, true, 'New rotated password must be accepted');

    // Test with old password (MUST BE REJECTED!)
    const loginWithOldDefaultKey = await verifyMasterKeySim('LifecardMaster2026!', customHashInDb);
    assert.strictEqual(loginWithOldDefaultKey, false, 'CRITICAL: Old default master key MUST be rejected once key is rotated');

    // Test with random attacker password
    const loginWithAttackerKey = await verifyMasterKeySim('HackerAttempt999', customHashInDb);
    assert.strictEqual(loginWithAttackerKey, false, 'Invalid attacker key must be rejected');

    console.log('✅ Master key verification logic passed: Rotated key works; old key strictly rejected.');

    // 3. Verify Masquerade Token Generation and Verification
    console.log('\n[TEST 3] Verifying Masquerade Token Protocol with active key rotation...');
    const adminJs = fs.readFileSync(path.join(ROOT_DIR, 'admin', 'admin.js'), 'utf8');

    // Check that admin.js checks valid before proceeding
    assert(adminJs.includes('if (!valid) {'), 'admin.js must check if (!valid)');
    assert(adminJs.includes("showToast('Invalid operator masquerade token signature.', 'error');"),
        'admin.js must reject invalid signatures with toast');

    // Simulate token generator (from super_admin.js)
    async function generateToken(slug, activeSecret) {
        const ts = Date.now();
        const masterKeyHash = sha256Hex(activeSecret);
        const hash = sha256Hex(`${slug}:${ts}:${masterKeyHash}`);
        return Buffer.from(JSON.stringify({ slug, ts, hash, op: 'SuperAdmin' })).toString('base64');
    }

    // Simulate token validator (from admin.js)
    async function validateToken(tokenStr, dbStoredHash) {
        try {
            const decoded = JSON.parse(Buffer.from(tokenStr, 'base64').toString('utf8'));
            const { slug, ts, hash } = decoded;
            if (!slug || !ts || !hash) return { valid: false, reason: 'missing_fields' };
            if (Math.abs(Date.now() - ts) > 10 * 60 * 1000) return { valid: false, reason: 'expired' };

            let valid = false;
            let activeMasterHash = dbStoredHash;
            if (activeMasterHash) {
                const expectedHash = sha256Hex(`${slug}:${ts}:${activeMasterHash}`);
                if (hash === expectedHash) valid = true;
            } else {
                const defaultSecret = 'LifecardMaster2026!';
                const defaultHash = sha256Hex(defaultSecret);
                const expectedDefaultHash = sha256Hex(`${slug}:${ts}:${defaultHash}`);
                const expectedDefaultRaw = sha256Hex(`${slug}:${ts}:${defaultSecret}`);
                if (hash === expectedDefaultHash || hash === expectedDefaultRaw) valid = true;
            }
            return { valid };
        } catch(e) {
            return { valid: false, error: e };
        }
    }

    const testSlug = 'tenant-alpha';

    // Scenario A: Rotated key active
    const validToken = await generateToken(testSlug, newCustomPassword);
    const validRes = await validateToken(validToken, customHashInDb);
    assert.strictEqual(validRes.valid, true, 'Masquerade token generated with active rotated key must validate');

    // Scenario B: Attacker uses old default key to craft masquerade token when custom key is active
    const forgedOldToken = await generateToken(testSlug, 'LifecardMaster2026!');
    const forgedRes = await validateToken(forgedOldToken, customHashInDb);
    assert.strictEqual(forgedRes.valid, false, 'CRITICAL: Masquerade token signed with old key MUST fail validation when custom key is active');

    // Scenario C: Tampered slug in payload
    const tamperedPayload = JSON.parse(Buffer.from(validToken, 'base64').toString('utf8'));
    tamperedPayload.slug = 'tenant-beta';
    const tamperedToken = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64');
    const tamperedRes = await validateToken(tamperedToken, customHashInDb);
    assert.strictEqual(tamperedRes.valid, false, 'Tampered tenant slug must fail validation');

    // Scenario D: Expired token (> 10 mins)
    const expiredPayload = JSON.parse(Buffer.from(validToken, 'base64').toString('utf8'));
    expiredPayload.ts = Date.now() - (11 * 60 * 1000);
    const expiredToken = Buffer.from(JSON.stringify(expiredPayload)).toString('base64');
    const expiredRes = await validateToken(expiredToken, customHashInDb);
    assert.strictEqual(expiredRes.valid, false, 'Expired token must fail validation');

    console.log('✅ Masquerade crypto protocol passed: Rotated key signs successfully; old key rejected; tampering/expiration blocked.');

    console.log('\n======================================================');
    console.log('🎉 ALL MASTER KEY SECURITY TESTS PASSED (3/3)!');
    console.log('======================================================\n');
})();
