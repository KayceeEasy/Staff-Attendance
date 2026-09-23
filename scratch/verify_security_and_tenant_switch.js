const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = 'C:\\Users\\Kaycee\\Documents\\scripts\\Staff_Attendance';

console.log('\n======================================================');
console.log('🧪 EMPIRICAL TEST SUITE: SECURITY, HYBRID & MULTI-ADMIN');
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

// 1. Watch Tower Concealment
console.log('--- 1. Watch Tower Concealment & Stealth ---');
test('robots.txt does NOT contain /watch-tower/', () => {
    const content = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
    assert(!content.includes('/watch-tower/'), 'robots.txt must NOT leak /watch-tower/ route');
});

test('super-admin/index.html is disguised as a 404 page without redirect to watch-tower', () => {
    const content = fs.readFileSync(path.join(ROOT, 'super-admin', 'index.html'), 'utf8');
    assert(content.includes('404'), 'super-admin/index.html must display 404');
    assert(!content.includes('watch-tower'), 'super-admin/index.html must not mention watch-tower');
    assert(!content.includes('http-equiv="refresh"'), 'super-admin/index.html must not have meta refresh');
});

// 2. Hybrid Schedule Security (Zero ?key=admin)
console.log('\n--- 2. Hybrid Schedule Security (Zero ?key=admin) ---');
test('admin/admin.js does not contain ?key=admin', () => {
    const content = fs.readFileSync(path.join(ROOT, 'admin', 'admin.js'), 'utf8');
    assert(!content.includes('?key=admin'), 'admin.js must not contain ?key=admin');
    assert(content.includes('href="../hybrid/?tenant='), 'admin.js must link to hybrid with tenant parameter');
});

test('onboard/onboard.js does not contain ?key=admin', () => {
    const content = fs.readFileSync(path.join(ROOT, 'onboard', 'onboard.js'), 'utf8');
    assert(!content.includes('?key=admin'), 'onboard.js must not contain ?key=admin');
});

test('watch-tower/watch_tower.js and super-admin/super_admin.js do not contain ?key=admin', () => {
    const wtContent = fs.readFileSync(path.join(ROOT, 'watch-tower', 'watch_tower.js'), 'utf8');
    const saContent = fs.readFileSync(path.join(ROOT, 'super-admin', 'super_admin.js'), 'utf8');
    assert(!wtContent.includes('?key=admin'), 'watch_tower.js must not contain ?key=admin');
    assert(!saContent.includes('?key=admin'), 'super_admin.js must not contain ?key=admin');
});

test('sandbox_server.js does not contain ?key=admin', () => {
    const content = fs.readFileSync(path.join(ROOT, 'sandbox_server.js'), 'utf8');
    assert(!content.includes('?key=admin'), 'sandbox_server.js must not contain ?key=admin');
});

test('hybrid/script.js guards autoSync strictly by IS_ADMIN', () => {
    const content = fs.readFileSync(path.join(ROOT, 'hybrid', 'script.js'), 'utf8');
    assert(content.includes('if (!isWorkspaceAuthorized || !activeTenantSlug || !IS_ADMIN) return;'),
        'autoSync must require IS_ADMIN');
});

test('hybrid/script.js defines handleHybridAdminLogin and updateAdminModeUI', () => {
    const content = fs.readFileSync(path.join(ROOT, 'hybrid', 'script.js'), 'utf8');
    assert(content.includes('function handleHybridAdminLogin'), 'handleHybridAdminLogin must be defined');
    assert(content.includes('function updateAdminModeUI'), 'updateAdminModeUI must be defined');
    assert(content.includes('function handleSwitchWorkspace'), 'handleSwitchWorkspace must be defined');
});

test('hybrid/index.html includes #hybrid-admin-login-modal and Admin Edit button', () => {
    const content = fs.readFileSync(path.join(ROOT, 'hybrid', 'index.html'), 'utf8');
    assert(content.includes('id="hybrid-admin-login-modal"'), 'index.html must have #hybrid-admin-login-modal');
    assert(content.includes('id="hybrid-admin-login-btn"'), 'index.html must have #hybrid-admin-login-btn');
    assert(content.includes('id="hybrid-switch-btn"'), 'index.html must have #hybrid-switch-btn');
});

// 3. Multi-Admin Management
console.log('\n--- 3. Multi-Admin Management & Tenant Isolation ---');
test('common.js defines getTenantAdminList and saveTenantAdminList', () => {
    const content = fs.readFileSync(path.join(ROOT, 'common.js'), 'utf8');
    assert(content.includes('async function getTenantAdminList'), 'getTenantAdminList must be defined');
    assert(content.includes('async function saveTenantAdminList'), 'saveTenantAdminList must be defined');
});

test('common.js list-admin-users scopes users to tenantSlug', () => {
    const content = fs.readFileSync(path.join(ROOT, 'common.js'), 'utf8');
    assert(content.includes("case 'list-admin-users':"), 'list-admin-users case must exist');
    assert(content.includes("const delegatedAdmins = await getTenantAdminList(tenantSlug);"), 
        'list-admin-users must query tenant admin list');
});

test('common.js add-admin-user stores user in delegatedAdmins with tenantSlug', () => {
    const content = fs.readFileSync(path.join(ROOT, 'common.js'), 'utf8');
    assert(content.includes("await saveTenantAdminList(tenantSlug, delegatedAdmins);"), 
        'add-admin-user must save to tenant admin list');
});

test('admin/admin.js passes tenantSlug to list-admin-users and add-admin-user', () => {
    const content = fs.readFileSync(path.join(ROOT, 'admin', 'admin.js'), 'utf8');
    assert(content.includes("mode: 'list-admin-users', tenantSlug: slug"), 
        'admin.js must pass tenantSlug to list-admin-users');
    assert(content.includes("mode: 'add-admin-user'"), 'admin.js must have add-admin-user');
    assert(content.includes("tenantSlug: getActiveAdminTenantSlug()"), 'admin.js must pass active admin tenant slug');
});

// 4. Switch Tenant Functionality
console.log('\n--- 4. Switch Tenant & Workspace Functionality ---');
test('script.js reliably initializes kiosk modules across all readyState values', () => {
    const content = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    assert(content.includes("function initKioskModules()"), 'initKioskModules must be defined');
    assert(content.includes("if (document.readyState === 'loading')"), 'must check document.readyState');
});

test('script.js openWorkspaceConnectModal and closeWorkspaceConnectModal toggle .active class', () => {
    const content = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    assert(content.includes("overlay.classList.add('active');"), 'openWorkspaceConnectModal must add active class');
    assert(content.includes("overlay.classList.remove('active');"), 'closeWorkspaceConnectModal must remove active class');
});

test('script.js handleConnect sets active_tenant_slug and attendance_tenant_slug and wipes old binding', () => {
    const content = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    assert(content.includes("safeStorage.setItem('active_tenant_slug', matched.slug);"), 'must set active_tenant_slug');
    assert(content.includes("safeStorage.setItem('attendance_tenant_slug', matched.slug);"), 'must set attendance_tenant_slug');
    assert(content.includes("safeStorage.removeItem(STORAGE_KEYS.deviceLock);"), 'must clean previous lock when switching');
});

test('index.html switch-workspace-btn has onclick="openWorkspaceConnectModal()"', () => {
    const content = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert(content.includes('id="switch-workspace-btn" type="button" onclick="openWorkspaceConnectModal()"'),
        'switch-workspace-btn must have inline onclick handler');
});

test('admin/admin.js handleLogout clears admin_tenant_slug and displays switch link in header', () => {
    const content = fs.readFileSync(path.join(ROOT, 'admin', 'admin.js'), 'utf8');
    assert(content.includes("safeSession.removeItem('admin_tenant_slug');"), 'handleLogout must clear admin_tenant_slug');
    assert(content.includes('title="Switch company workspace"'), 'admin header must display switch link');
});

console.log('\n======================================================');
console.log(`📊 RESULTS: ${passCount} tests passed`);
console.log('======================================================\n');
