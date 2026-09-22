// Empirical Verification Script: Language Selector Visibility & Switch Button
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- STARTING EMPIRICAL VERIFICATION: LANGUAGE SELECTOR & SWITCH BUTTON ---');

const ROOT_DIR = path.resolve(__dirname, '..');

// 1. Verify HTML Structure in index.html
console.log('\n[TEST 1] Verifying index.html elements...');
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

assert(indexHtml.includes('id="switch-workspace-btn"'), 'index.html must have #switch-workspace-btn');
assert(indexHtml.includes('id="workspace-connect-close"'), 'index.html must have #workspace-connect-close');
assert(indexHtml.includes('id="workspace-connect-overlay"'), 'index.html must have #workspace-connect-overlay');

// Ensure language selector is in BOTH topbar and workspace connect overlay
const topbarSection = indexHtml.substring(indexHtml.indexOf('<div class="topbar">'), indexHtml.indexOf('<div class="loc-status-bar">'));
assert(topbarSection.includes('class="lang-selector-wrap"'), 'index.html topbar must contain .lang-selector-wrap');
assert(topbarSection.includes('id="lang-select-btn"'), 'index.html topbar must contain #lang-select-btn');

const overlaySection = indexHtml.substring(indexHtml.indexOf('id="workspace-connect-overlay"'), indexHtml.indexOf('id="biometric-enroll-modal"'));
assert(overlaySection.includes('class="lang-selector-wrap"'), '#workspace-connect-overlay must contain .lang-selector-wrap');
assert(overlaySection.includes('id="workspace-connect-close"'), '#workspace-connect-overlay must have close button');

console.log('✅ PASS: Language selector present in both topbar and workspace connect overlay; close button present.');

// 2. Verify Super Admin & Admin Language Selectors
console.log('\n[TEST 2] Verifying Super Admin and Admin language selectors...');
const superAdminHtml = fs.readFileSync(path.join(ROOT_DIR, 'super-admin', 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT_DIR, 'admin', 'index.html'), 'utf8');

const superGate = superAdminHtml.substring(superAdminHtml.indexOf('id="auth-gate-modal"'), superAdminHtml.indexOf('id="super-admin-shell"'));
assert(superGate.includes('class="lang-selector-wrap"'), 'super-admin gate modal must have .lang-selector-wrap');

const superHeader = superAdminHtml.substring(superAdminHtml.indexOf('<header class="super-header">'), superAdminHtml.indexOf('</header>'));
assert(superHeader.includes('class="lang-selector-wrap"'), 'super-admin header must have .lang-selector-wrap');

const adminTopbar = adminHtml.substring(adminHtml.indexOf('<div class="topbar">'), adminHtml.indexOf('<div class="admin-hero">'));
assert(adminTopbar.includes('class="lang-selector-wrap"'), 'admin topbar must have .lang-selector-wrap');

console.log('✅ PASS: All portal login and header surfaces feature .lang-selector-wrap.');

// 3. Verify CSS Rules for Layout & Non-shrinking
console.log('\n[TEST 3] Verifying CSS layout rules...');
const styleCss = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');

assert(styleCss.includes('.topbar-actions {'), 'style.css must define .topbar-actions');
assert(styleCss.includes('flex-shrink: 0'), 'style.css must declare flex-shrink: 0 on .topbar-actions, .lang-selector-wrap');
assert(styleCss.includes('.lang-selector-wrap {'), 'style.css must define .lang-selector-wrap');
assert(styleCss.includes('.lang-btn {'), 'style.css must define .lang-btn');

const superAdminCss = fs.readFileSync(path.join(ROOT_DIR, 'super-admin', 'style.css'), 'utf8');
assert(superAdminCss.includes('.lang-selector-wrap'), 'super-admin/style.css must define .lang-selector-wrap');
assert(superAdminCss.includes('.lang-btn'), 'super-admin/style.css must define .lang-btn');
assert(superAdminCss.includes('.lang-dropdown-menu'), 'super-admin/style.css must define .lang-dropdown-menu');

console.log('✅ PASS: CSS specifies flex-shrink: 0 and styles across main and super-admin apps.');

// 4. Verify Script.js Event Binding for Switch Button & Modal
console.log('\n[TEST 4] Verifying script.js event handling for Switch button and modal...');
const scriptJs = fs.readFileSync(path.join(ROOT_DIR, 'script.js'), 'utf8');

assert(scriptJs.includes("const switchBtn = document.getElementById('switch-workspace-btn');"),
    'script.js must target switch-workspace-btn');
assert(scriptJs.includes("const closeBtn = document.getElementById('workspace-connect-close');"),
    'script.js must target workspace-connect-close');
assert(scriptJs.includes('openWorkspaceConnectModal'), 'script.js must define openWorkspaceConnectModal');
assert(scriptJs.includes('closeWorkspaceConnectModal'), 'script.js must define closeWorkspaceConnectModal');

// Ensure switchBtn is bound in initWorkspaceConnect unconditionally (not delayed inside async initTenantBranding)
const initWorkspaceConnectFn = scriptJs.substring(scriptJs.indexOf('function initWorkspaceConnect()'), scriptJs.indexOf('async function initTenantBranding()'));
assert(initWorkspaceConnectFn.includes("switchBtn.addEventListener('click'"), 'switchBtn must be bound in initWorkspaceConnect');
assert(initWorkspaceConnectFn.includes("closeBtn.addEventListener('click'"), 'closeBtn must be bound in initWorkspaceConnect');
assert(initWorkspaceConnectFn.includes("overlay.addEventListener('click'"), 'overlay backdrop click must be bound in initWorkspaceConnect');

console.log('✅ PASS: Switch button, close button, and backdrop handlers unconditionally bound in initWorkspaceConnect.');

// 5. Verify Version Bump & Cache Busting
console.log('\n[TEST 5] Verifying version bump and cache busting...');
const versionJs = fs.readFileSync(path.join(ROOT_DIR, 'version.js'), 'utf8');
assert(versionJs.includes("APP_VERSION = '3.0.1'"), 'version.js must be bumped to 3.0.1');
assert(indexHtml.includes('common.js?v=3.0.1'), 'index.html must reference common.js?v=3.0.1');
assert(indexHtml.includes('script.js?v=3.0.1'), 'index.html must reference script.js?v=3.0.1');

console.log('✅ PASS: Version bumped to 3.0.1 across version.js and script cache-busters.');

console.log('\n======================================================');
console.log('🎉 ALL SWITCH BUTTON & LANGUAGE SELECTOR TESTS PASSED (5/5)!');
console.log('======================================================\n');
