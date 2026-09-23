const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✅ PASS: ${testName}`);
    } else {
        console.error(`  ❌ FAIL: ${testName} - ${details}`);
    }
}

console.log('\n======================================================');
console.log('🧪 EMPIRICAL TEST SUITE: MULTI-TENANT & WATCH TOWER');
console.log('======================================================\n');

// 1. Check common.js for lifecard fallback elimination
console.log('--- 1. Multi-Tenant Scoping & Zero Lifecard Fallbacks ---');
const commonJs = fs.readFileSync(path.join(ROOT, 'common.js'), 'utf8').replace(/\r\n/g, '\n');

// Check that resolveRequestedTenantSlug exists
assert(commonJs.includes('async function resolveRequestedTenantSlug(payload)'), 'resolveRequestedTenantSlug helper defined');

// Check that no payload.tenantSlug || ... : 'lifecard' exists
const lifecardFallbackRegex = /payload\.tenantSlug\s*\|\|\s*\(activeTenant\s*\?\s*activeTenant\.slug\s*:\s*['"]lifecard['"]\)/i;
assert(!lifecardFallbackRegex.test(commonJs), 'Zero hardcoded (payload.tenantSlug || ... "lifecard") fallback instances');

// Check that list-staff, add-staff, list-logs, get-hybrid-schedule use resolveRequestedTenantSlug
assert(commonJs.includes("case 'list-staff': {\n                const tenantSlug = await resolveRequestedTenantSlug(payload);"), 'list-staff uses resolveRequestedTenantSlug');
assert(commonJs.includes("case 'add-staff': {\n                const tenantSlug = await resolveRequestedTenantSlug(payload);"), 'add-staff uses resolveRequestedTenantSlug');
assert(commonJs.includes("case 'list-logs': {\n                const tenantSlug = await resolveRequestedTenantSlug(payload);"), 'list-logs uses resolveRequestedTenantSlug');
assert(commonJs.includes("case 'get-hybrid-schedule': {\n                const tenantSlug = await resolveRequestedTenantSlug(payload);"), 'get-hybrid-schedule uses resolveRequestedTenantSlug');

// Check that admin-login returns tenantSlug
assert(commonJs.includes('tenantSlug: tenantSlug,') && commonJs.includes('tenant: matchedTenant || null'), 'admin-login returns tenantSlug and tenant from registry');

// Check that was_unlinked_by_admin is cleared upon notification in verify-staff-member
assert(commonJs.includes('delete member.was_unlinked_by_admin;') && commonJs.includes('saveTenantStaffList(tenantSlug, staff);'), 'verify-staff-member clears was_unlinked_by_admin to stop perpetual alert on refresh');

// 2. Admin Console Multi-Tenant Wiring
console.log('\n--- 2. Admin Console Multi-Tenant Wiring ---');
const adminJs = fs.readFileSync(path.join(ROOT, 'admin', 'admin.js'), 'utf8');

assert(adminJs.includes('function getActiveAdminTenantSlug()'), 'getActiveAdminTenantSlug helper exists in admin.js');
assert(adminJs.includes("callBackend({ mode: 'list-staff', tenantSlug: slug })"), 'listStaff passes tenantSlug');
assert(adminJs.includes("callBackend({ mode: 'add-staff', name, dept, schedule_policy, is_team_lead, include_in_reports, tenantSlug: slug })"), 'addStaff passes tenantSlug');
assert(adminJs.includes("callBackend({ mode: 'update-staff', name, ...updates, tenantSlug: slug })"), 'updateStaff passes tenantSlug');
assert(adminJs.includes("callBackend({ mode: 'list-logs', ...filters, tenantSlug: slug })"), 'fetchLogs passes tenantSlug');
assert(adminJs.includes("callBackend({ mode: 'get-hybrid-schedule', weekStart, tenantSlug: slug })"), 'fetchHybridSchedule passes tenantSlug');
assert(adminJs.includes("safeSession.setItem('admin_tenant_slug', response.tenantSlug)"), 'handleAdminLogin stores admin_tenant_slug');

// 3. Watch Tower GPS & Policies Tab Parity
console.log('\n--- 3. Watch Tower GPS & Policies Parity ---');
const watchTowerHtml = fs.readFileSync(path.join(ROOT, 'watch-tower', 'index.html'), 'utf8');
const watchTowerJs = fs.readFileSync(path.join(ROOT, 'watch-tower', 'watch_tower.js'), 'utf8');

assert(watchTowerHtml.includes('id="master-timezone"'), 'Watch Tower has #master-timezone selector');
assert(watchTowerHtml.includes('id="master-workdays"'), 'Watch Tower has #master-workdays selector');
assert(watchTowerHtml.includes('id="master-late-cutoff"'), 'Watch Tower has #master-late-cutoff input');
assert(watchTowerHtml.includes('id="master-closing-time"'), 'Watch Tower has #master-closing-time input');
assert(watchTowerHtml.includes('id="master-hybrid-office-days"'), 'Watch Tower has #master-hybrid-office-days selector');
assert(watchTowerHtml.includes('id="master-wfh-quota"'), 'Watch Tower has #master-wfh-quota selector');
assert(watchTowerHtml.includes('id="master-lead-priority"'), 'Watch Tower has #master-lead-priority selector');
assert(!watchTowerHtml.includes('value="executive"'), 'Deprecated "executive" policy removed from Watch Tower');

assert(watchTowerJs.includes("document.getElementById('master-timezone').value = tenant.timezone"), 'watch_tower.js populates timezone in openTenantMasterModal');
assert(watchTowerJs.includes("document.getElementById('master-late-cutoff').value = `${lateH}:${lateM}`"), 'watch_tower.js populates late cutoff in openTenantMasterModal');
assert(watchTowerJs.includes("document.getElementById('master-closing-time').value = `${closeH}:${closeM}`"), 'watch_tower.js populates closing time in openTenantMasterModal');
assert(watchTowerJs.includes("const late_cutoff_minutes = (lateH * 60) + (lateM || 0);"), 'watch_tower.js calculates and saves late cutoff');
assert(watchTowerJs.includes("const workday_end_minutes = (closeH * 60) + (closeM || 0);"), 'watch_tower.js calculates and saves workday end minutes');

// 4. URL Migration (/super-admin -> /watch-tower)
console.log('\n--- 4. Watch Tower URL Migration ---');
const superAdminHtml = fs.readFileSync(path.join(ROOT, 'super-admin', 'index.html'), 'utf8');

assert(!superAdminHtml.includes('watch-tower') && superAdminHtml.includes('404 Not Found'), 'super-admin/index.html is disguised as authentic 404 without leaking watch-tower');
assert(fs.existsSync(path.join(ROOT, 'watch-tower', 'index.html')), 'watch-tower/index.html exists');
assert(fs.existsSync(path.join(ROOT, 'watch-tower', 'watch_tower.js')), 'watch-tower/watch_tower.js exists');
assert(fs.existsSync(path.join(ROOT, 'watch-tower', 'style.css')), 'watch-tower/style.css exists');

const robotsTxt = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
assert(!robotsTxt.includes('watch-tower'), 'robots.txt does not leak secret /watch-tower/ to scanners');

// 5. Kiosk 'Change' Button, Device Switch Modal & Biometrics
console.log('\n--- 5. Kiosk Change Button, Device Switch & Biometrics ---');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

assert(indexHtml.includes('id="switch-identity-btn"'), 'index.html contains #switch-identity-btn in linked-identity-card');
assert(indexHtml.includes('id="device-transfer-modal"'), 'index.html contains #device-transfer-modal');
assert(indexHtml.includes('id="faq-footer-link"'), 'index.html contains #faq-footer-link in footer');
assert(indexHtml.includes('id="biometric-enroll-modal"'), 'index.html contains #biometric-enroll-modal');

assert(scriptJs.includes('openDeviceTransferModal'), 'script.js defines openDeviceTransferModal');
assert(scriptJs.includes('initDeviceTransferModal'), 'script.js defines initDeviceTransferModal');
assert(scriptJs.includes('enrollBiometrics'), 'script.js calls enrollBiometrics in showBiometricEnrollModal');
assert(scriptJs.includes('verifyBiometrics'), 'script.js verifies biometrics before check-in');
assert(scriptJs.includes('faqFooterLink'), 'script.js wires faqFooterLink to openFaqModal');

// 6. Mobile Layout & Service Worker
console.log('\n--- 6. Mobile Layout & Service Worker ---');
const styleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const versionJs = fs.readFileSync(path.join(ROOT, 'version.js'), 'utf8');

assert(styleCss.includes('#faq-btn { display: none !important; }'), 'style.css hides topbar FAQ button on mobile in favor of footer');
assert(styleCss.includes('.topbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap; gap: 8px; }'), 'style.css enforces nowrap on mobile topbar');
assert(swJs.includes("if (event.request.mode === 'navigate')"), 'sw.js implements Network-First for navigation');
assert(swJs.includes("/watch-tower/"), 'sw.js bypasses /watch-tower/ portal');
assert(versionJs.includes("APP_VERSION = '3.0.4'"), 'version.js bumped to 3.0.4');

console.log('\n======================================================');
console.log(`📊 RESULTS: ${passedTests} / ${totalTests} tests passed`);
console.log('======================================================\n');

if (passedTests === totalTests) {
    process.exit(0);
} else {
    process.exit(1);
}
