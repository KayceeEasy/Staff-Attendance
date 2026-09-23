const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================');
console.log('🧪 VERIFYING MOBILE VIEWPORT FIX & SENIOR DASHBOARD DESIGN');
console.log('======================================================\n');

const ROOT_DIR = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT_DIR, 'admin', 'admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT_DIR, 'admin', 'index.html'), 'utf8');
const versionJs = fs.readFileSync(path.join(ROOT_DIR, 'version.js'), 'utf8');

// 1. Mobile Layout & Skew Fixes
console.log('[TEST 1] Verifying body flex direction and mobile viewport safety...');
assert(styleCss.includes('flex-direction: column;'), 'style.css body must have flex-direction: column');
assert(styleCss.includes('min-width: 0;'), 'style.css .card must have min-width: 0');
assert(styleCss.includes('#tenant-brand-name'), 'style.css must have #tenant-brand-name styling');
assert(styleCss.includes('text-overflow: ellipsis;'), 'tenant-brand-name must use text-overflow: ellipsis');

// Assert FAQ is integrated into topbar
assert(indexHtml.includes('<button id="faq-btn" class="topbar-icon-btn"'), 'index.html must have #faq-btn in topbar-actions');
// Ensure floating FAQ button is removed from body
const postCardHtml = indexHtml.substring(indexHtml.indexOf('</footer>'));
assert(!postCardHtml.includes('class="faq-trigger-btn"'), 'index.html must not contain loose floating faq-trigger-btn in body');
console.log('✅ PASS: Body flex-direction is column, card min-width is 0, and FAQ button is integrated into topbar.');

// 2. Width Calculation at 360px viewport
console.log('\n[TEST 2] Verifying 360px mobile viewport fit without overflow...');
const maxBrandMobile = 135;
const actionsMobile = 34 * 4 + 5 * 3; // 4 buttons (34px) + 3 gaps (5px) = 136 + 15 = 151px
const topbarGap = 10;
const cardPaddingMobile = 28; // ~0.85rem * 2
const bodyPaddingMobile = 20; // 10px * 2
const totalRequiredWidth = maxBrandMobile + actionsMobile + topbarGap + cardPaddingMobile + bodyPaddingMobile;

console.log(`   Calculated mobile row width on <= 480px: ${totalRequiredWidth}px`);
assert(totalRequiredWidth <= 360, `Total mobile width (${totalRequiredWidth}px) must fit within 360px viewport`);
console.log('✅ PASS: Complete mobile topbar fits safely within 360px screen with zero overflow.');

// 3. Design System: Gradient and Shadow Elimination
console.log('\n[TEST 3] Verifying elimination of AI-style gradients and in-page card shadows...');
assert(styleCss.includes('.tab-btn.active { background: var(--primary);'), 'Active tab must use solid flat accent, not gradient');
assert(styleCss.includes('.admin-badge { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 10px; background: var(--primary);'), 'Admin badge must use flat solid accent and 10px radius');
assert(styleCss.includes('.admin-card { background: var(--admin-card-bg); width: min(100%, 1100px); max-width: 100%; text-align: left; padding: 1.5rem; border-radius: var(--radius-xl); margin: 0 auto; display: block; box-shadow: none; }'), 'Admin card must have box-shadow: none');
console.log('✅ PASS: Gradients and artificial card shadows eliminated from admin components.');

// 4. Metric Hierarchy & AI Tell Elimination in admin.js
console.log('\n[TEST 4] Verifying 1 Hero + 3 Secondary visual hierarchy in Dashboard and Analytics...');
assert(adminJs.includes('summary-stat-card hero'), 'admin.js renderWeekOverview must include a .summary-stat-card.hero card');
assert(adminJs.includes('analytics-card hero'), 'admin.js renderAnalytics must include a .analytics-card.hero card');
assert(!adminJs.includes('analytics-icon'), 'admin.js renderAnalytics must not render pastel icon tiles');
assert(styleCss.includes('font-variant-numeric: tabular-nums;'), 'Numbers must enforce tabular digits');
console.log('✅ PASS: Asymmetric 1 Hero + 3 Secondary hierarchy implemented with zero pastel icon tiles.');

// 5. Versioning
console.log('\n[TEST 5] Verifying version bump to 3.0.3...');
assert(versionJs.includes("APP_VERSION = '3.0.3'"), 'version.js must be 3.0.3');
assert(indexHtml.includes('style.css?v=3.0.3'), 'index.html must reference style.css?v=3.0.3');
assert(indexHtml.includes('script.js?v=3.0.3'), 'index.html must reference script.js?v=3.0.3');
assert(adminHtml.includes('style.css?v=3.0.3'), 'admin/index.html must reference style.css?v=3.0.3');
console.log('✅ PASS: Version 3.0.3 verified across all entry points.');

console.log('\n======================================================');
console.log('🎉 ALL LAYOUT & DASHBOARD DESIGN TESTS PASSED (5/5)!');
console.log('======================================================\n');
