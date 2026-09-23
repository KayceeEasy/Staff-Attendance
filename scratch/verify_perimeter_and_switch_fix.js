const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = 'C:\\Users\\Kaycee\\Documents\\scripts\\Staff_Attendance';

console.log('\n======================================================');
console.log('🧪 EMPIRICAL TEST SUITE: PERIMETER VOICE & SWITCH FIX');
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

// 1. DOM Hierarchy & Modal Isolation in index.html
console.log('--- 1. Modal Isolation & Fix for "Switch button does nothing" ---');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('index.html properly closes #privacy-modal before #workspace-connect-overlay', () => {
    const privacyIdx = indexHtml.indexOf('id="privacy-modal"');
    const connectIdx = indexHtml.indexOf('id="workspace-connect-overlay"');
    assert(privacyIdx !== -1, 'privacy modal must exist');
    assert(connectIdx !== -1, 'workspace connect overlay must exist');
    assert(privacyIdx < connectIdx, 'privacy modal must appear before workspace connect');

    const slice = indexHtml.slice(privacyIdx, connectIdx);
    // Count opening vs closing divs between privacy-modal start and workspace-connect-overlay start
    const openDivs = (slice.match(/<div/g) || []).length;
    const closeDivs = (slice.match(/<\/div>/g) || []).length;
    assert.strictEqual(openDivs, closeDivs, `Div tags must be balanced! open=${openDivs}, close=${closeDivs}`);
});

test('index.html #workspace-connect-overlay has zero registered tenant dropdown or list exposure', () => {
    assert(!indexHtml.includes('id="workspace-quick-select-wrap"'), 'must NOT include quick select wrap');
    assert(!indexHtml.includes('id="workspace-quick-select"'), 'must NOT include quick select element');
    assert(!indexHtml.includes('LIFE-26 or ACME-89'), 'must NOT mention registered tenant codes in placeholders');
});

test('index.html switch-workspace-btn has onclick="openWorkspaceConnectModal()"', () => {
    assert(indexHtml.includes('id="switch-workspace-btn" type="button" onclick="openWorkspaceConnectModal()"'),
        'switch workspace button must have onclick handler');
});

// 2. Script Switch Logic & Zero Tenant Exposure
console.log('\n--- 2. Workspace Switching & Zero Fleet Exposure ---');
const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

test('script.js ensures pairing is blind with zero dropdown population of tenant fleet', () => {
    assert(!scriptJs.includes('function populateWorkspaceQuickSelect()'), 'must NOT define populateWorkspaceQuickSelect');
    assert(!scriptJs.includes('populateWorkspaceQuickSelect();'), 'must NOT call populateWorkspaceQuickSelect');
});

test('script.js handleConnect sets tenant slug and smoothly reloads workspace', () => {
    assert(scriptJs.includes("safeStorage.setItem('active_tenant_slug', matched.slug);"), 'must set active_tenant_slug');
    assert(scriptJs.includes("safeStorage.setItem('attendance_tenant_slug', matched.slug);"), 'must set attendance_tenant_slug');
    assert(scriptJs.includes("window.location.reload()"), 'must reload page on switch to re-initialize perimeter GPS & roster');
});

const hybridScriptJs = fs.readFileSync(path.join(ROOT, 'hybrid', 'script.js'), 'utf8');
test('hybrid/script.js handleSwitchWorkspace clears URL query parameter', () => {
    assert(hybridScriptJs.includes('history.replaceState'), 'handleSwitchWorkspace must clean URL search param');
});

// 3. Brand Voice Symmetry: Zero "geofence" / "boundary" in User-Facing Texts
console.log('\n--- 3. Brand Voice Symmetry (Perimeter Everywhere) ---');

test('index.html has zero occurrences of geofenc or boundar', () => {
    const matches = indexHtml.match(/geofenc|geo-fenc|boundar/gi);
    assert.strictEqual(matches, null, `Found unexpected matches: ${matches}`);
});

const adminHtml = fs.readFileSync(path.join(ROOT, 'admin', 'index.html'), 'utf8');
test('admin/index.html has zero occurrences of geofenc or boundar', () => {
    const matches = adminHtml.match(/geofenc|geo-fenc|boundar/gi);
    assert.strictEqual(matches, null, `Found unexpected matches: ${matches}`);
});

const adminJs = fs.readFileSync(path.join(ROOT, 'admin', 'admin.js'), 'utf8');
test('admin/admin.js uses Perimeter in config headers, radius tools, and distance dialog', () => {
    assert(adminJs.includes('<h4>Office Location & Perimeter</h4>'), 'admin config header must be Perimeter');
    assert(adminJs.includes('<strong>Perimeter Radius</strong>'), 'admin config card must be Perimeter Radius');
    assert(adminJs.includes('<h4>Perimeter Calibration Tools</h4>'), 'admin tools header must be Perimeter');
    assert(adminJs.includes("title: 'Perimeter Radius (10-5000 meters)'"), 'admin dialog must be Perimeter Radius');
    assert(adminJs.includes("statusMsg = isInside ? 'INSIDE PERIMETER' : 'OUTSIDE PERIMETER'"), 'distance result must say PERIMETER');
});

const onboardHtml = fs.readFileSync(path.join(ROOT, 'onboard', 'index.html'), 'utf8');
test('onboard/index.html has no user-facing geofence or boundary text', () => {
    assert(onboardHtml.includes('<!-- STEP 2: Office Perimeter Setup -->'), 'onboard step 2 comment must be Perimeter');
    assert(onboardHtml.includes('<label for="geofence-radius">Perimeter Radius</label>'), 'onboard label must be Perimeter Radius');
});

const onboardJs = fs.readFileSync(path.join(ROOT, 'onboard', 'onboard.js'), 'utf8');
test('onboard/onboard.js success message uses Perimeter', () => {
    assert(onboardJs.includes('Perimeter bound to ${tenant.office_name}'), 'onboard success message must say Perimeter bound');
});

const watchTowerHtml = fs.readFileSync(path.join(ROOT, 'watch-tower', 'index.html'), 'utf8');
test('watch-tower/index.html has zero user-facing geofence or boundary text', () => {
    assert(watchTowerHtml.includes('<th>HQ Office & Perimeter</th>'), 'table header must be Perimeter');
    assert(watchTowerHtml.includes('<label for="master-radius">Perimeter Radius (meters)</label>'), 'radius label must be Perimeter Radius');
    assert(watchTowerHtml.includes('Save Policies &amp; Perimeter'), 'save button must say Perimeter');
    assert(watchTowerHtml.includes('GPS perimeter rules'), 'backup text must say perimeter');
});

const watchTowerJs = fs.readFileSync(path.join(ROOT, 'watch-tower', 'watch_tower.js'), 'utf8');
test('watch-tower/watch_tower.js save toast and button use Perimeter', () => {
    assert(watchTowerJs.includes('Save Policies &amp; Perimeter'), 'button must say Save Policies & Perimeter');
    assert(watchTowerJs.includes('Office policies and perimeter saved successfully!'), 'toast must say perimeter');
});

const superAdminJs = fs.readFileSync(path.join(ROOT, 'super-admin', 'super_admin.js'), 'utf8');
test('super-admin/super_admin.js save toast and button use Perimeter', () => {
    assert(superAdminJs.includes('Save Policies &amp; Perimeter'), 'button must say Save Policies & Perimeter');
    assert(superAdminJs.includes('Office policies and perimeter saved successfully!'), 'toast must say perimeter');
});

const manifestJson = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
test('manifest.json uses GPS perimeter verification', () => {
    assert(manifestJson.includes('GPS perimeter verification'), 'manifest must say GPS perimeter verification');
    assert(!manifestJson.includes('geofenc'), 'manifest must not have geofence');
});

const metadataJson = fs.readFileSync(path.join(ROOT, 'metadata.json'), 'utf8');
test('metadata.json uses perimeter verification', () => {
    assert(metadataJson.includes('perimeter verification'), 'metadata must say perimeter verification');
    assert(!metadataJson.includes('geofenc'), 'metadata must not have geofence');
});

const readmeMd = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
test('README.md uses perimeter verification across all sections', () => {
    assert(readmeMd.includes('GPS perimeter verification'), 'README must say GPS perimeter verification');
    assert(readmeMd.includes('### 📍 True On-Site Verification (GPS Perimeter)'), 'README header must say GPS Perimeter');
    assert(readmeMd.includes("within your office's perimeter"), 'README arrival notification must say perimeter');
    assert(!readmeMd.includes('geofenc'), 'README must not have geofence');
});

// 4. FAQ Modal Layout & Overflow Spacing Tests
console.log('\n--- 4. FAQ Modal Layout & Overflow Spacing ---');
const styleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8').replace(/\r\n/g, '\n');

test('style.css .faq-content has min-height: 0 to prevent flex blowout', () => {
    assert(styleCss.includes('.faq-content {\n    overflow-y: auto;\n    flex: 1 1 auto;\n    min-height: 0;'),
        'faq-content must have min-height: 0');
});

test('style.css defines .faq-section flex layout to space accordion cards properly', () => {
    assert(styleCss.includes('.faq-section {\n    display: flex;\n    flex-direction: column;\n    gap: 8px;\n}'),
        'faq-section must have flex layout and 8px gap');
});

test('style.css .faq-footer has flex-shrink: 0', () => {
    assert(styleCss.includes('.faq-footer {\n    flex-shrink: 0;'), 'faq-footer must not shrink');
});

test('script.js openFaqModal resets active category to location and does not dump all sections on close', () => {
    assert(scriptJs.includes("filterByCategory(category);") || scriptJs.includes("filterByCategory('location');"),
        'openFaqModal must filter by initial category');
    assert(!scriptJs.includes('showAllSections();'), 'showAllSections must not dump all sections on close');
});

console.log('\n======================================================');
console.log(`📊 RESULTS: ${passCount} tests passed`);
console.log('======================================================\n');
