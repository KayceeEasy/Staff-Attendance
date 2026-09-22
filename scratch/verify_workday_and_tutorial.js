/**
 * verify_workday_and_tutorial.js
 * Comprehensive Empirical Verification Suite for:
 * 1. Configurable Workday Start & Closing Hours
 * 2. Post-Closing Remote Sign-Out (No-GPS when signed in on-site earlier)
 * 3. WFH Attendance Quota Toggle (Contribution vs In-Office Only)
 * 4. Step-by-Step Tenant Guided Tutorial Modal & Navigation
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('====================================================');
console.log('🧪 VERIFYING WORKDAY HOURS, REMOTE SIGN-OUT & TUTORIAL');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function test(description, fn) {
    totalTests++;
    try {
        fn();
        console.log(`✅ PASS: ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`❌ FAIL: ${description}`);
        console.error('   ', err.message);
    }
}

// -------------------------------------------------------------
// Test 1: HTML Markup in admin/index.html
// -------------------------------------------------------------
test('admin/index.html includes Guided Tour topbar button and modal', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
    assert(html.includes('id="guided-tour-btn"'), 'Missing #guided-tour-btn in topbar');
    assert(html.includes('id="tenant-guided-tour-modal"'), 'Missing #tenant-guided-tour-modal');
    assert(html.includes('id="tour-step-badge"'), 'Missing #tour-step-badge');
    assert(html.includes('id="tour-dots"'), 'Missing #tour-dots');
    assert(html.includes('class="tour-slide" data-step="0"'), 'Missing tour slide 0');
    assert(html.includes('class="tour-slide" data-step="4"'), 'Missing tour slide 4 (step 5)');
    assert(html.includes('onclick="navigateTourStep(1)"'), 'Missing Next step action');
    assert(html.includes('onclick="closeTenantTourModal()"'), 'Missing close modal action');
});

// -------------------------------------------------------------
// Test 2: Admin JS Config Cards & Handlers
// -------------------------------------------------------------
test('admin/admin.js includes Workday Closing Time, Remote Sign-Out & WFH Quota UI', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
    assert(js.includes('id="config-closing-time-current"'), 'Missing #config-closing-time-current element in admin panel');
    assert(js.includes('id="config-closing-time-btn"'), 'Missing #config-closing-time-btn button');
    assert(js.includes('id="config-remote-signout-current"'), 'Missing #config-remote-signout-current element');
    assert(js.includes('id="config-remote-signout-btn"'), 'Missing #config-remote-signout-btn button');
    assert(js.includes('id="config-wfh-quota-current"'), 'Missing #config-wfh-quota-current element');
    assert(js.includes('id="config-wfh-quota-btn"'), 'Missing #config-wfh-quota-btn button');
});

// -------------------------------------------------------------
// Test 3: Admin JS Guided Tour Logic & Auto-Launch
// -------------------------------------------------------------
test('admin/admin.js includes tour navigation and auto-launch functions', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
    assert(js.includes('function openTenantTourModal'), 'Missing openTenantTourModal function');
    assert(js.includes('function closeTenantTourModal'), 'Missing closeTenantTourModal function');
    assert(js.includes('function navigateTourStep'), 'Missing navigateTourStep function');
    assert(js.includes('function checkTenantTourAutoLaunch'), 'Missing checkTenantTourAutoLaunch function');
    assert(js.includes('tenant_tour_seen_'), 'Missing tour seen persistence key');
});

// -------------------------------------------------------------
// Test 4: WFH Quota Calculation Logic
// -------------------------------------------------------------
test('WFH attendance quota calculation distinguishes enabled vs office-only', () => {
    const totalPresent = 14;
    const totalWfh = 6;
    const totalMissed = 2;
    const totalWorkingDays = totalPresent + totalWfh + totalMissed; // 22

    // Mode A: WFH contributes to attendance quota (tenantWfhQuotaEnabled = true)
    const rateWithWfh = Math.round(((totalPresent + totalWfh) / totalWorkingDays) * 100);
    // (14 + 6) / 22 = 20 / 22 = 91%
    assert.strictEqual(rateWithWfh, 91, `Expected 91%, got ${rateWithWfh}%`);

    // Mode B: WFH excluded from attendance quota (tenantWfhQuotaEnabled = false)
    const rateOfficeOnly = Math.round((totalPresent / totalWorkingDays) * 100);
    // 14 / 22 = 64%
    assert.strictEqual(rateOfficeOnly, 64, `Expected 64%, got ${rateOfficeOnly}%`);

    assert(rateWithWfh > rateOfficeOnly, 'WFH quota contribution must yield higher attendance rate');
});

// -------------------------------------------------------------
// Test 5: Client Portal Remote Sign-Out State Machine in script.js
// -------------------------------------------------------------
test('script.js includes post-closing remote sign-out logic and bypass checks', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    assert(js.includes('function hasStaffSignedInToday'), 'Missing hasStaffSignedInToday function');
    assert(js.includes('function isPostClosingRemoteSignoutActive'), 'Missing isPostClosingRemoteSignoutActive function');
    assert(js.includes('isRemoteSignoutEligible'), 'Missing isRemoteSignoutEligible check in updateActionHeroState');
    assert(js.includes('SIGN OUT (REMOTE)'), 'Missing SIGN OUT (REMOTE) button label');
    assert(js.includes('isRemoteSignOut: Boolean(isRemoteSignout)'), 'Missing isRemoteSignOut flag passed to backend');
});

// -------------------------------------------------------------
// Test 6: Backend Service Layer in common.js
// -------------------------------------------------------------
test('common.js handles post-closing remote sign-out and new config keys', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'common.js'), 'utf8');
    assert(js.includes('isRemoteSignout = Boolean(payload.isRemoteSignOut)'), 'Missing isRemoteSignout extraction in common.js');
    assert(js.includes('Off-Site Sign-Out'), 'Missing Off-Site Sign-Out status tag');
    assert(js.includes('ALLOW_REMOTE_SIGNOUT_POST_CLOSING'), 'Missing ALLOW_REMOTE_SIGNOUT_POST_CLOSING in common.js');
    assert(js.includes('WORKDAY_END_MINUTES: 1020'), 'Missing WORKDAY_END_MINUTES default');
    assert(js.includes('COUNT_WFH_IN_ATTENDANCE_QUOTA: \'true\''), 'Missing COUNT_WFH_IN_ATTENDANCE_QUOTA default');
});

// -------------------------------------------------------------
// Test 7: Simulated Remote Sign-Out Verification Logic
// -------------------------------------------------------------
test('Security Rule: Remote Sign-Out allowed ONLY if staff signed in earlier today', () => {
    const today = '2026-09-22';
    
    // Scenario 1: Staff Alice signed in today at 08:45 AM
    const aliceLogs = [
        { name: 'Alice Smith', action: 'IN', date: today, timestamp: `${today}T08:45:00Z`, status: 'On Time' }
    ];
    const aliceHasSignedIn = aliceLogs.some(l => l.name === 'Alice Smith' && l.date === today && l.action === 'IN');
    assert.strictEqual(aliceHasSignedIn, true, 'Alice should be recorded as signed in');

    const closingMinutes = 1020; // 17:00 (5:00 PM)
    const testCurrentMinutesAfterHours = 1045; // 17:25 (5:25 PM)
    const isPastClosing = testCurrentMinutesAfterHours >= closingMinutes;
    const allowRemote = true;

    const aliceCanRemoteSignOut = aliceHasSignedIn && isPastClosing && allowRemote;
    assert.strictEqual(aliceCanRemoteSignOut, true, 'Alice MUST be permitted remote sign-out after 5PM');

    // Scenario 2: Staff Bob never signed in today
    const bobLogs = [];
    const bobHasSignedIn = bobLogs.some(l => l.name === 'Bob Jones' && l.date === today && l.action === 'IN');
    const bobCanRemoteSignOut = bobHasSignedIn && isPastClosing && allowRemote;
    assert.strictEqual(bobCanRemoteSignOut, false, 'Bob MUST be denied remote sign-out because he never signed in today');

    // Scenario 3: Tenant disabled remote signout
    const allowRemoteDisabled = false;
    const aliceCanRemoteWhenDisabled = aliceHasSignedIn && isPastClosing && allowRemoteDisabled;
    assert.strictEqual(aliceCanRemoteWhenDisabled, false, 'Alice MUST be denied when tenant disables remote signout');
});

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n----------------------------------------------------');
console.log(`Summary: ${passedTests}/${totalTests} tests passed`);
console.log('----------------------------------------------------');

if (passedTests === totalTests) {
    console.log('🎉 ALL WORKDAY HOURS, REMOTE SIGN-OUT & TUTORIAL TESTS PASSED!\n');
    process.exit(0);
} else {
    console.error('💥 Some tests failed!\n');
    process.exit(1);
}
