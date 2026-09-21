const assert = require('assert');
const fs = require('fs');

console.log('====================================================');
console.log('🧪 VERIFYING UNIVERSAL CLEAN URL & WEBAUTHN BIOMETRICS');
console.log('====================================================');

// Mock browser environment
const storage = {};
global.window = {
    location: {
        origin: 'http://localhost:8080',
        pathname: '/',
        search: '',
        hostname: 'localhost'
    },
    history: {
        replaceState: (state, title, url) => {
            const parsed = new URL(url, 'http://localhost:8080');
            global.window.location.pathname = parsed.pathname;
            global.window.location.search = parsed.search;
        }
    },
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    crypto: {
        getRandomValues: (buf) => {
            for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
            return buf;
        }
    },
    PublicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: async () => true
    }
};

global.document = {
    title: 'Attendance Cloud',
    documentElement: { style: { setProperty: () => {} } },
    getElementById: (id) => ({
        value: '',
        style: {},
        innerHTML: '',
        textContent: '',
        addEventListener: () => {},
        dispatchEvent: () => {}
    })
};

const mockNavigator = {
    credentials: {
        create: async (opts) => {
            return {
                id: 'mock_credential_id_12345',
                rawId: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer,
                type: 'public-key'
            };
        },
        get: async (opts) => {
            return {
                id: 'mock_credential_id_12345',
                rawId: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer,
                response: {
                    signature: new Uint8Array([99, 88, 77]).buffer
                }
            };
        }
    }
};
global.navigator = mockNavigator;
global.window.navigator = mockNavigator;

global.safeStorage = {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
};

// Mock Supabase
const dbConfig = {};
const mockSupabase = {
    from: (table) => ({
        select: () => ({
            eq: (col, val) => ({
                single: async () => {
                    if (dbConfig[val]) return { data: { key: val, value: dbConfig[val] }, error: null };
                    return { data: null, error: { message: 'Not found' } };
                }
            })
        }),
        upsert: async (rows) => {
            rows.forEach(r => { dbConfig[r.key] = r.value; });
            return { error: null };
        }
    })
};
global.supabaseClient = mockSupabase;
global.window.supabase = {
    createClient: () => mockSupabase
};

// Load common.js
const commonCode = fs.readFileSync('C:\\Users\\Kaycee\\Documents\\scripts\\Staff_Attendance\\common.js', 'utf8');
eval(commonCode);

async function runTests() {
    // TEST 1: Workspace Code Generation
    console.log('\n--- 1. Workspace Code Generation & Format ---');
    const codeAcme = generateWorkspaceCode('acme');
    const codeGlobex = generateWorkspaceCode('globex');
    console.log('Acme Code:', codeAcme);
    console.log('Globex Code:', codeGlobex);
    assert(codeAcme.startsWith('ACME-'), 'Acme code must start with ACME-');
    assert(codeGlobex.startsWith('GLOB-'), 'Globex code must start with GLOB-');
    
    const regCheck = await getTenantRegistry();
    const lifecardSeed = regCheck.find(t => t.slug === 'lifecard');
    assert(lifecardSeed && lifecardSeed.workspace_code === 'LIFE-26', 'Lifecard seed has LIFE-26 code');
    console.log('✅ PASS: Workspace Code generation verified.');

    // Seed registry
    const initialRegistry = [
        { ...lifecardSeed },
        {
            id: 'acme',
            slug: 'acme',
            workspace_code: 'ACME-42',
            name: 'Acme Corporation',
            status: 'active'
        },
        {
            id: 'globex',
            slug: 'globex',
            workspace_code: 'GLOB-88',
            name: 'Globex Inc',
            status: 'active'
        }
    ];
    await saveTenantRegistry(initialRegistry);

    // TEST 2: Lookup by Workspace Code
    console.log('\n--- 2. Tenant Lookup by Workspace Code ---');
    const foundAcme = await getTenantByWorkspaceCode('ACME-42');
    assert(foundAcme && foundAcme.slug === 'acme', 'Must find Acme by ACME-42');
    const foundGlobex = await getTenantByWorkspaceCode('glob-88'); // case insensitive
    assert(foundGlobex && foundGlobex.slug === 'globex', 'Must find Globex case-insensitively');
    const foundNone = await getTenantByWorkspaceCode('FAKE-99');
    assert.strictEqual(foundNone, null, 'Must return null for unknown code');
    console.log('✅ PASS: Workspace Code lookup verified.');

    // TEST 3: Strict Zero-Exposure for Unpaired Device on Clean URL
    console.log('\n--- 3. Strict Zero-Exposure on Root Clean URL (/) ---');
    // Ensure storage has no active tenant
    safeStorage.removeItem('active_tenant_slug');
    global.window.location.pathname = '/';
    global.window.location.search = '';

    const unpairedTenant = await getActiveTenant();
    assert.strictEqual(unpairedTenant, null, 'Unpaired device on "/" MUST return null (no default fallback)');
    console.log('✅ PASS: Root URL returns null for unpaired device (zero data leakage).');

    // TEST 4: One-Time Join via Setup Link & URL Rewrite to '/'
    console.log('\n--- 4. One-Time Setup Link (?join=CODE) & URL Cleaning ---');
    global.window.location.pathname = '/';
    global.window.location.search = '?join=ACME-42';

    const pairedTenant = await getActiveTenant();
    assert(pairedTenant && pairedTenant.slug === 'acme', 'Must resolve Acme from ?join=ACME-42');
    assert.strictEqual(safeStorage.getItem('active_tenant_slug'), 'acme', 'Must save active_tenant_slug in device storage');
    assert.strictEqual(global.window.location.search, '', 'Must clean the search parameter to empty string');
    assert.strictEqual(global.window.location.pathname, '/', 'URL pathname remains clean "/"');
    console.log('✅ PASS: Device paired and URL cleanly rewritten to "/".');

    // TEST 5: Subsequent Visit (Day 2) without URL params
    console.log('\n--- 5. Subsequent Clean Visit (Day 2+) ---');
    global.window.location.pathname = '/';
    global.window.location.search = ''; // zero params, pure '/'

    const day2Tenant = await getActiveTenant();
    assert(day2Tenant && day2Tenant.slug === 'acme', 'Must remember Acme via device storage on clean "/"');
    console.log('✅ PASS: Day 2+ visits instantly resolve tenant from device storage on pure "/".');

    // TEST 6: WebAuthn Native Biometrics Support Check
    console.log('\n--- 6. WebAuthn Biometric Support Detection ---');
    const isAvail = await isBiometricsAvailable();
    assert.strictEqual(isAvail, true, 'isBiometricsAvailable must return true with mock platform authenticator');
    console.log('✅ PASS: Biometrics availability check verified.');

    // TEST 7: Biometric Enrollment Flow
    console.log('\n--- 7. Biometric Enrollment (navigator.credentials.create) ---');
    assert.strictEqual(isBiometricsEnrolled('John Doe'), false, 'Not enrolled initially');
    const enrollRes = await enrollBiometrics('emp_01', 'John Doe', 'Acme Corporation');
    assert.strictEqual(enrollRes.success, true, 'Enrollment succeeds');
    assert(enrollRes.credentialId, 'Must return base64 credentialId');
    assert.strictEqual(isBiometricsEnrolled('John Doe'), true, 'isBiometricsEnrolled must now return true');
    console.log('Credential ID Base64:', enrollRes.credentialId);
    console.log('✅ PASS: Biometric enrollment flow verified.');

    // TEST 8: Biometric Verification Flow
    console.log('\n--- 8. Biometric Verification (navigator.credentials.get) ---');
    const verifyRes = await verifyBiometrics('John Doe');
    assert.strictEqual(verifyRes.success, true, 'Biometric verification passes');
    assert(verifyRes.assertion, 'Must return assertion object');

    // Test rejection/cancellation simulation
    global.window.navigator.credentials.get = async () => { throw new Error('User cancelled Face ID'); };
    const failRes = await verifyBiometrics('John Doe');
    assert.strictEqual(failRes.success, false, 'Failed/cancelled biometric returns success: false');
    console.log('Cancelled check message:', failRes.message);
    console.log('✅ PASS: Biometric verification and cancellation handled correctly.');

    // TEST 9: Biometric Unlink/Clear
    console.log('\n--- 9. Biometric Cleanup on Device Unlink ---');
    clearBiometrics('John Doe');
    assert.strictEqual(isBiometricsEnrolled('John Doe'), false, 'Biometric enrollment cleared');
    console.log('✅ PASS: Biometrics successfully cleared upon device unlinking.');

    console.log('\n====================================================');
    console.log('🎉 ALL 9 ARCHITECTURAL TESTS PASSED PERFECTLY (CODE 0)');
    console.log('====================================================');
}

runTests().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
