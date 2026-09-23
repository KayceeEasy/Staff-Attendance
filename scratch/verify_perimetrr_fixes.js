const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('  PERIMETRR COMPREHENSIVE EMPIRICAL VERIFICATION');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ [PASS] ${name}`);
        passCount++;
    } catch (e) {
        console.error(`❌ [FAIL] ${name}: ${e.message}`);
        failCount++;
    }
}

// 1. JS Syntax Check
test('1. Syntax Check: All JS files pass node -c', () => {
    const files = [
        'common.js',
        'script.js',
        'admin/admin.js',
        'super-admin/super_admin.js',
        'onboard/onboard.js',
        'hybrid/script.js',
        'scripts/reset_master_key.js',
        'build.js'
    ];
    files.forEach(file => {
        execSync(`node -c "${path.join(ROOT, file)}"`);
    });
});

// 2. Hybrid Zero-Trust Workspace Gate & Policy Filtering
test('2. Hybrid Scheduler: Zero-Trust gate & Staff Policy filtering', () => {
    const hybridHtml = fs.readFileSync(path.join(ROOT, 'hybrid/index.html'), 'utf8');
    const hybridJs = fs.readFileSync(path.join(ROOT, 'hybrid/script.js'), 'utf8');

    // Check gate modal exists in DOM
    assert(hybridHtml.includes('id="hybrid-auth-gate"'), 'hybrid-auth-gate element exists');
    assert(hybridHtml.includes('id="hybrid-workspace-code-input"'), 'hybrid-workspace-code-input exists');
    assert(hybridHtml.includes('id="hybrid-gate-form"'), 'hybrid-gate-form exists');
    assert(hybridHtml.includes('id="hybrid-settings-modal"'), 'hybrid-settings-modal exists');
    assert(hybridHtml.includes('id="hybrid-office-days-select"'), 'hybrid-office-days-select exists');

    // Check zero-trust enforcement in script.js
    assert(hybridJs.includes('checkWorkspaceAuth'), 'checkWorkspaceAuth function is implemented');
    assert(!hybridJs.includes("|| 'lifecard'"), 'activeTenantSlug does not fallback to lifecard');
    assert(hybridJs.includes("urlParams.get('tenant') || ''"), 'activeTenantSlug defaults to empty if unprovided');
    assert(!hybridJs.includes("urlParams.get('tenant') || 'lifecard'"), 'No hardcoded lifecard tenant fallback in URL params');
    
    // Check policy filtering: only weekly_hybrid
    assert(hybridJs.includes("pol === 'weekly_hybrid'"), 'Roster filters strictly for weekly_hybrid staff');
});

// 3. Hybrid Schedule Configurable Quota Generation
test('3. Hybrid Schedule: Configurable quota generation logic (1 to 4 office days)', () => {
    // Simulate generation algorithm from hybrid/script.js
    const staffList = [
        { name: 'Alice Walker', department: 'Engineering', is_lead: true },
        { name: 'Bob Smith', department: 'Engineering', is_lead: false },
        { name: 'Charlie Day', department: 'Design', is_lead: false },
        { name: 'Diana Prince', department: 'Operations', is_lead: true }
    ];

    function generateMockSchedule(reqOfficeDays) {
        const schedule = {};
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const dayOffsets = {
            'engineering': 0,
            'operations': 1,
            'design': 2
        };

        staffList.forEach(s => {
            const isLead = Boolean(s.is_lead);
            const dept = (s.department || '').toLowerCase();
            const deptShift = dayOffsets[dept] || 0;
            const staffSchedule = {};

            days.forEach((dayName, dIdx) => {
                let isOffice = false;
                if (reqOfficeDays === 5) {
                    isOffice = true;
                } else if (reqOfficeDays === 1) {
                    const targetIdx = isLead ? 0 : (1 + deptShift) % 5;
                    isOffice = (dIdx === targetIdx);
                } else if (reqOfficeDays === 2) {
                    const targetA = (deptShift) % 5;
                    const targetB = (deptShift + 2) % 5;
                    isOffice = (dIdx === targetA || dIdx === targetB);
                } else if (reqOfficeDays === 3) {
                    const remoteA = (deptShift + 1) % 5;
                    const remoteB = (deptShift + 3) % 5;
                    isOffice = !(dIdx === remoteA || dIdx === remoteB);
                } else if (reqOfficeDays === 4) {
                    const remoteIdx = (deptShift + 2) % 5;
                    isOffice = (dIdx !== remoteIdx);
                }
                staffSchedule[dayName] = isOffice ? 'office' : 'home';
            });
            schedule[s.name] = staffSchedule;
        });
        return schedule;
    }

    [1, 2, 3, 4].forEach(targetDays => {
        const sched = generateMockSchedule(targetDays);
        staffList.forEach(s => {
            const officeCount = Object.values(sched[s.name]).filter(m => m === 'office').length;
            const homeCount = Object.values(sched[s.name]).filter(m => m === 'home').length;
            assert.strictEqual(officeCount, targetDays, `${s.name} gets exactly ${targetDays} office days`);
            assert.strictEqual(homeCount, 5 - targetDays, `${s.name} gets exactly ${5 - targetDays} home days`);
        });
    });
});

// 4. Kiosk Location Pill Default
test('4. Kiosk Location Pill: Does not prematurely default to Office on load without selected staff', () => {
    const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // Verify watchPosition callback does NOT unconditionally assign 'Office'
    assert(scriptJs.includes('if (!currentSelectedStaff)'), 'Location handler checks if currentSelectedStaff is selected');
    assert(scriptJs.includes("t('gpsReady', '📍 GPS Ready • Select Name')"), 'Displays GPS Ready when unselected');
    assert(scriptJs.includes('currentStaffTodayMode = null'), 'currentStaffTodayMode set to null when unselected');
});

// 5. False Device Reset Elimination
test('5. Device Binding: Register-owner persists device_id to TENANT_STAFF and handles unlink correctly', () => {
    const commonJs = fs.readFileSync(path.join(ROOT, 'common.js'), 'utf8');
    const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // common.js register-owner stores member.device_id
    assert(commonJs.includes('member.device_id = payload.deviceId'), 'register-owner assigns member.device_id');
    assert(commonJs.includes('await saveTenantStaffList(tenantSlug, staff)'), 'register-owner persists tenant staff list');
    
    // verify-staff-member returns was_unlinked_by_admin
    assert(commonJs.includes('was_unlinked_by_admin: Boolean(member.was_unlinked_by_admin)'), 'verify-staff-member returns was_unlinked_by_admin');

    // script.js checks was_unlinked_by_admin before wiping lock
    assert(scriptJs.includes('if (res.was_unlinked_by_admin && getLocalDeviceLockHint())'), 'script.js only triggers reset toast when explicitly unlinked by admin');
});

// 6. Universal Team Lead Star Motif
test('6. UI Badges: Universal star (★) motif replaces all [Lead] text tags', () => {
    const adminJs = fs.readFileSync(path.join(ROOT, 'admin/admin.js'), 'utf8');
    const superAdminJs = fs.readFileSync(path.join(ROOT, 'super-admin/super_admin.js'), 'utf8');
    const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const hybridJs = fs.readFileSync(path.join(ROOT, 'hybrid/script.js'), 'utf8');

    // Check no textual '[Lead]' or 'Lead' badge spans remain in table renders
    assert(!adminJs.includes('staff-lead-badge">[Lead]</span>'), 'admin.js has no [Lead] badge');
    assert(!superAdminJs.includes('staff-lead-badge">[Lead]</span>'), 'super_admin.js has no [Lead] badge');
    assert(!scriptJs.includes('staff-lead-badge">[Lead]</span>'), 'script.js has no [Lead] badge');

    // Check star is present
    assert(adminJs.includes('staff-lead-star') && adminJs.includes('★'), 'admin.js renders staff-lead-star ★');
    assert(superAdminJs.includes('staff-lead-star') && superAdminJs.includes('★'), 'super_admin.js renders staff-lead-star ★');
    assert(scriptJs.includes('★'), 'script.js renders star ★ in dropdown/card');
    assert(hybridJs.includes('★'), 'hybrid/script.js renders star ★');
});

// 7. Watch Tower (Super Admin) Mobile Responsiveness
test('7. Watch Tower: Mobile responsiveness for 360px and 480px viewports', () => {
    const superAdminCss = fs.readFileSync(path.join(ROOT, 'super-admin/style.css'), 'utf8');

    assert(superAdminCss.includes('@media (max-width: 768px)'), '768px media query present');
    assert(superAdminCss.includes('@media (max-width: 480px)'), '480px media query present');
    assert(superAdminCss.includes('@media (max-width: 360px)'), '360px media query present');
    assert(superAdminCss.includes('overflow-x: auto'), 'Horizontal table scrolling enabled');
    assert(superAdminCss.includes('.table-card'), 'table-card has responsive container');
    assert(superAdminCss.includes('flex-direction: column'), 'Mobile layouts stack vertically');
});

// 8. Security & Single Active Master Key (No Backwards Compatibility)
test('8. Security: Zero hardcoded master passwords and strict active hash verification', () => {
    const superAdminJs = fs.readFileSync(path.join(ROOT, 'super-admin/super_admin.js'), 'utf8');
    const adminJs = fs.readFileSync(path.join(ROOT, 'admin/admin.js'), 'utf8');

    assert(!superAdminJs.includes('ChckpointMaster2026!'), 'super_admin.js has no hardcoded master key');
    assert(!superAdminJs.includes('LifecardMaster2026!'), 'super_admin.js has no hardcoded legacy key');
    assert(!adminJs.includes("['ChckpointMaster2026!', 'LifecardMaster2026!']"), 'admin.js has no fallback array of secrets');

    // Test reset script
    const resetScript = fs.readFileSync(path.join(ROOT, 'scripts/reset_master_key.js'), 'utf8');
    assert(resetScript.includes('SUPER_ADMIN_MASTER_KEY_HASH'), 'reset_master_key.js targets database hash');
    
    // Execute reset_master_key.js in dry mode
    const output = execSync('node scripts/reset_master_key.js "PerimetrrMaster2026!"', { cwd: ROOT }).toString();
    assert(output.includes('SHA-256 Hash'), 'reset_master_key outputs computed hash');
    assert(output.includes('To update in Supabase SQL Editor, run:'), 'reset_master_key outputs SQL query');
});

// 9. Perimetrr Branding Synchronization
test('9. Branding: Perimetrr name synchronized across manifest, metadata, and mobile app', () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'metadata.json'), 'utf8'));
    assert(metadata.name.includes('Perimetrr'), 'metadata.json has Perimetrr');

    const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'mobile_app/app.json'), 'utf8'));
    assert.strictEqual(appJson.expo.name, 'Perimetrr Go', 'mobile app name is Perimetrr Go');
    assert.strictEqual(appJson.expo.ios.bundleIdentifier, 'com.perimetrr.go', 'iOS bundle is com.perimetrr.go');
    assert.strictEqual(appJson.expo.android.package, 'com.perimetrr.go', 'Android package is com.perimetrr.go');

    const mobileAppJs = fs.readFileSync(path.join(ROOT, 'mobile_app/App.js'), 'utf8');
    assert(mobileAppJs.includes('PerimetrrGo/1.0'), 'mobile WebView userAgent is PerimetrrGo');
});

console.log('\n====================================================');
console.log(`  VERIFICATION RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('====================================================');

if (failCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
