const assert = require('assert');
const fs = require('fs');

// We simulate backend calls using common.js environment
// We mock window, localStorage, sessionStorage, and supabaseClient
const storage = {};
global.window = {
    location: { pathname: '/', search: '', origin: 'http://localhost:8080' },
    localStorage: {
        getItem: (k) => storage[k] || null,
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: (k) => { delete storage[k]; }
    },
    sessionStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    }
};
global.document = {
    addEventListener: () => {},
    getElementById: () => ({
        addEventListener: () => {},
        value: '',
        style: {}
    }),
    querySelectorAll: () => []
};
global.safeStorage = global.window.localStorage;
global.safeSession = global.window.sessionStorage;

// In-memory mock database store for app_config
const dbConfig = {};

const mockClient = {
    from: (table) => {
        if (table === 'app_config') {
            return {
                select: () => ({
                    eq: (col, val) => ({
                        single: async () => {
                            if (dbConfig[val]) return { data: { key: val, value: dbConfig[val] }, error: null };
                            return { data: null, error: { message: 'Not found' } };
                        }
                    }),
                    limit: () => Promise.resolve({ data: [{ key: 'mock' }], error: null })
                }),
                upsert: async (rows) => {
                    for (const r of rows) {
                        dbConfig[r.key] = r.value;
                    }
                    return { error: null };
                },
                delete: () => ({
                    in: async (col, vals) => {
                        vals.forEach(v => delete dbConfig[v]);
                        return { error: null };
                    }
                })
            };
        }
        if (table === 'staff') {
            return {
                select: () => ({
                    order: async () => ({ data: [{ name: 'Ayomide' }, { name: 'Kenneth' }], error: null })
                }),
                insert: async () => ({ error: null }),
                update: () => ({ eq: async () => ({ error: null }), neq: async () => ({ error: null }) }),
                delete: () => ({ eq: async () => ({ error: null }) })
            };
        }
        if (table === 'attendance') {
            return {
                select: () => ({
                    order: () => ({
                        limit: async () => ({ data: [], error: null })
                    })
                }),
                delete: () => ({ eq: async () => ({ error: null }) })
            };
        }
        return {};
    }
};

global.window.supabase = {
    createClient: () => mockClient
};
global.supabaseClient = mockClient;

// Evaluate common.js in this context
const commonCode = fs.readFileSync('common.js', 'utf8');
eval(commonCode);
supabaseClient = global.supabaseClient;

async function runTests() {
    console.log('🧪 Starting Multi-Tenant Isolation & Super Admin Master Control Tests...\n');

    // 1. Test Onboarding validation logic
    console.log('1. Testing Onboarding Slug & Word Moderation...');
    const onboardCode = fs.readFileSync('onboard/onboard.js', 'utf8');
    eval(onboardCode);

    // Reserved slugs test
    const resAdmin = validateTenantSlug('admin', 'Admin Corp');
    assert.strictEqual(resAdmin.valid, false, 'Reserved slug "admin" must be rejected');
    assert(resAdmin.message.includes('reserved'), 'Error message should mention reserved keyword');

    const resSuper = validateTenantSlug('super-admin', 'Super Admin LLC');
    assert.strictEqual(resSuper.valid, false, 'Reserved slug "super-admin" must be rejected');

    // Hate speech test
    const resHate = validateTenantSlug('hate-club', 'nigger corp');
    assert.strictEqual(resHate.valid, false, 'Explicit hate slurs must be blocked');

    // Soft-flag test: sensitive word allowed but marked for review
    const resBigAss = validateTenantSlug('big-ass-fans', 'Big Ass Fans');
    assert.strictEqual(resBigAss.valid, true, 'Legitimate company with sensitive word must be allowed');
    assert.strictEqual(resBigAss.needsReview, true, 'Sensitive word must trigger needsReview flag');

    // Clean valid slug
    const resAcme = validateTenantSlug('acme-corp', 'Acme Corporation');
    assert.strictEqual(resAcme.valid, true);
    assert.strictEqual(resAcme.needsReview, false);
    console.log('   ✅ PASS: Onboarding moderation correctly handles reserved slugs, slurs, and soft-flags!');

    // 2. Provision two distinct tenants: Acme and Globex
    console.log('\n2. Testing Multi-Tenant Provisioning in Supabase...');
    const onboardAcme = await callBackend({
        mode: 'onboard-tenant',
        tenant: {
            name: 'Acme Corporation',
            slug: 'acme',
            brand_color: '#e11d48',
            office_name: 'Acme HQ',
            latitude: 37.7749,
            longitude: -122.4194,
            radius: 200,
            admin_name: 'Wile Admin',
            admin_email: 'wile@acme.com',
            plan_tier: 'Enterprise'
        }
    });
    console.log('Onboard Acme response:', onboardAcme);
    assert(onboardAcme.ok, 'Failed to onboard Acme');

    const onboardGlobex = await callBackend({
        mode: 'onboard-tenant',
        tenant: {
            name: 'Globex International',
            slug: 'globex',
            brand_color: '#059669',
            office_name: 'Globex Dome',
            latitude: 40.7128,
            longitude: -74.0060,
            radius: 500,
            admin_name: 'Hank Scorpio',
            admin_email: 'hank@globex.com',
            plan_tier: 'Pro'
        }
    });
    assert(onboardGlobex.ok, 'Failed to onboard Globex');
    console.log('   ✅ PASS: Both tenants provisioned into registry!');

    // 3. Add staff to Acme and Globex
    console.log('\n3. Testing Staff Roster Isolation...');
    await callBackend({
        mode: 'add-staff',
        tenantSlug: 'acme',
        name: 'Wile E. Coyote',
        dept: 'Engineering',
        schedule_policy: 'field_flexible'
    });
    await callBackend({
        mode: 'add-staff',
        tenantSlug: 'acme',
        name: 'Road Runner',
        dept: 'Courier',
        schedule_policy: 'office_only'
    });

    await callBackend({
        mode: 'add-staff',
        tenantSlug: 'globex',
        name: 'Homer Simpson',
        dept: 'Nuclear',
        schedule_policy: 'executive',
        is_team_lead: true
    });

    // Verify Acme staff
    const acmeStaff = await callBackend({ mode: 'list-staff', tenantSlug: 'acme' });
    assert.strictEqual(acmeStaff.staff.length, 2, 'Acme should have exactly 2 staff');
    const acmeNames = acmeStaff.staff.map(s => s.name);
    assert(acmeNames.includes('Wile E. Coyote'));
    assert(acmeNames.includes('Road Runner'));
    assert(!acmeNames.includes('Homer Simpson'), 'Acme must not contain Globex staff!');

    // Verify Globex staff
    const globexStaff = await callBackend({ mode: 'list-staff', tenantSlug: 'globex' });
    assert.strictEqual(globexStaff.staff.length, 1, 'Globex should have exactly 1 staff');
    assert.strictEqual(globexStaff.staff[0].name, 'Homer Simpson');
    assert(!globexStaff.staff.map(s => s.name).includes('Wile E. Coyote'), 'Globex must not contain Acme staff!');

    // Verify Lifecard staff does not contain Acme or Globex
    const lifecardStaff = await callBackend({ mode: 'list-staff', tenantSlug: 'lifecard' });
    const lifecardNames = lifecardStaff.staff.map(s => s.name);
    assert(!lifecardNames.includes('Wile E. Coyote'), 'Lifecard must not leak Acme staff!');
    assert(!lifecardNames.includes('Homer Simpson'), 'Lifecard must not leak Globex staff!');
    console.log('   ✅ PASS: 100% staff roster isolation verified across all tenants!');

    // 4. Test Zero-Exposure Verification per Tenant
    console.log('\n4. Testing Zero-Exposure Staff Member Verification...');
    // Verifying Homer Simpson on Globex should SUCCEED
    const verifyGlobex = await callBackend({ mode: 'verify-staff-member', tenantSlug: 'globex', name: 'Homer Simpson' });
    assert(verifyGlobex.ok, 'Homer Simpson should verify for Globex');
    assert.strictEqual(verifyGlobex.dept, 'Nuclear');

    // Verifying Homer Simpson on Acme should FAIL
    const verifyAcme = await callBackend({ mode: 'verify-staff-member', tenantSlug: 'acme', name: 'Homer Simpson' });
    assert(!verifyAcme.ok, 'Homer Simpson must NOT verify on Acme');

    // Verifying Road Runner on Acme should SUCCEED
    const verifyRR = await callBackend({ mode: 'verify-staff-member', tenantSlug: 'acme', name: 'Road Runner' });
    assert(verifyRR.ok, 'Road Runner should verify on Acme');
    console.log('   ✅ PASS: Zero-exposure verification strictly honors tenant boundary!');

    // 5. Test Super Admin Master Control Operations
    console.log('\n5. Testing Super Admin Master Control Capabilities...');
    
    // Remote Device Unlinking
    await callBackend({
        mode: 'unlink-staff-device',
        tenantSlug: 'acme',
        name: 'Wile E. Coyote'
    });
    const refreshedAcme = await callBackend({ mode: 'list-staff', tenantSlug: 'acme' });
    const wile = refreshedAcme.staff.find(s => s.name === 'Wile E. Coyote');
    assert.strictEqual(wile.device_id, null, 'Wile E. Coyote device must be unlinked');
    console.log('   ✅ PASS: Super Admin remote device unlinking verified!');

    // Master Tenant Profile & Policy Update
    const updateRes = await callBackend({
        mode: 'super-admin-update-tenant-full',
        slug: 'acme',
        updates: {
            name: 'Acme Mega Corp',
            brand_color: '#b91c1c',
            plan_tier: 'Enterprise Custom',
            status: 'suspended'
        },
        config: {
            office_name: 'Acme Desert Facility',
            latitude: 36.1699,
            longitude: -115.1398,
            radius: 350,
            grace_period_minutes: 20,
            default_policy: 'field_flexible'
        }
    });
    assert(updateRes.ok, 'Super Admin master update failed');
    assert.strictEqual(updateRes.tenant.name, 'Acme Mega Corp');
    assert.strictEqual(updateRes.tenant.status, 'suspended');

    const acmeConfig = await getTenantConfig('acme');
    assert.strictEqual(acmeConfig.radius, 350);
    assert.strictEqual(acmeConfig.grace_period_minutes, 20);
    console.log('   ✅ PASS: Super Admin master profile and policy update verified!');

    // Password Reset
    const passReset = await callBackend({
        mode: 'super-admin-reset-tenant-password',
        slug: 'acme',
        newPassword: 'NewSecurePassword2026!'
    });
    assert(passReset.ok, 'Password reset failed');
    const registry = await getTenantRegistry();
    const acmeInReg = registry.find(t => t.slug === 'acme');
    assert.strictEqual(acmeInReg.admin_password, 'NewSecurePassword2026!');
    console.log('   ✅ PASS: Super Admin password reset verified!');

    // Delete Tenant Workspace
    const delRes = await callBackend({
        mode: 'super-admin-delete-tenant',
        slug: 'globex'
    });
    assert(delRes.ok, 'Delete tenant failed');
    const regAfterDel = await getTenantRegistry();
    assert(!regAfterDel.some(t => t.slug === 'globex'), 'Globex must be removed from registry');
    console.log('   ✅ PASS: Super Admin workspace deletion verified!');

    console.log('\n🎉 ALL MULTI-TENANT ISOLATION AND SUPER ADMIN MASTER CONTROL CHECKS PASSED EMPIRICALLY!\n');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
