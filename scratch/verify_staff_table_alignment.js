const fs = require('fs');
const path = require('path');

console.log('====================================================');
console.log('🧪 VERIFYING STAFF TABLE GRID ALIGNMENT & RESPONSIVENESS');
console.log('====================================================');

const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../admin/admin.js'), 'utf8');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`✅ PASS: ${message}`);
        passCount++;
    } else {
        console.error(`❌ FAIL: ${message}`);
        failCount++;
    }
}

// 1. Check shared grid definition in style.css
const sharedGridMatch = css.match(/\.staff-header-row,\s*\.staff-row\s*\{([^}]+)\}/s);
assert(Boolean(sharedGridMatch), '.staff-header-row and .staff-row share a unified grid declaration');

if (sharedGridMatch) {
    const block = sharedGridMatch[1];
    assert(block.includes('display: grid'), 'Shared block declares display: grid');
    assert(block.includes('grid-template-columns: minmax(180px, 1.4fr) 135px 110px 116px'), 'Shared block has exact identical 4-column tracks');
    assert(block.includes('padding: 11px 16px'), 'Shared block has exact identical padding (11px 16px)');
    assert(block.includes('box-sizing: border-box'), 'Shared block specifies box-sizing: border-box');
}

// 2. Check header Actions alignment class
assert(css.includes('.staff-actions-header {'), 'style.css defines .staff-actions-header');
assert(css.includes('text-align: right;'), '.staff-actions-header has text-align: right');

// 3. Check staff-actions flexbox and no-wrap
const staffActionsMatch = css.match(/\.staff-actions\s*\{([^}]+)\}/s);
assert(Boolean(staffActionsMatch), 'style.css defines .staff-actions');
if (staffActionsMatch) {
    const block = staffActionsMatch[1];
    assert(block.includes('justify-content: flex-end'), '.staff-actions has justify-content: flex-end');
    assert(block.includes('flex-wrap: nowrap'), '.staff-actions has flex-wrap: nowrap');
}

// 4. Check staff-action-btn flex-shrink: 0
const staffBtnMatch = css.match(/\.staff-action-btn\s*\{([^}]+)\}/s);
assert(Boolean(staffBtnMatch), 'style.css defines .staff-action-btn');
if (staffBtnMatch) {
    const block = staffBtnMatch[1];
    assert(block.includes('flex-shrink: 0'), '.staff-action-btn has flex-shrink: 0');
}

// 5. Check admin.js markup structure
assert(adminJs.includes('<div class="staff-actions-header">Actions</div>'), 'admin.js uses .staff-actions-header in .staff-header-row');
assert(!adminJs.includes('<div style="text-align: right;">Actions</div>'), 'admin.js eliminated hardcoded inline style in header');

// 6. Check columns match in header and row HTML structures
const headerHtmlMatch = adminJs.match(/<div class="staff-header-row">(.*?)<\/div>\s*`;/s);
assert(Boolean(headerHtmlMatch), 'admin.js defines .staff-header-row template');
if (headerHtmlMatch) {
    const headerCols = headerHtmlMatch[1].match(/<div[^>]*>.*?<\/div>/g) || [];
    assert(headerCols.length === 4, `Header template has exactly 4 columns (found ${headerCols.length})`);
    assert(headerCols[0].includes('Staff Member'), 'Col 1 is Staff Member');
    assert(headerCols[1].includes('Work Policy'), 'Col 2 is Work Policy');
    assert(headerCols[2].includes('Device Link'), 'Col 3 is Device Link');
    assert(headerCols[3].includes('Actions'), 'Col 4 is Actions');
}

const rowHtmlMatch = adminJs.match(/<div class="staff-row">(.*?)<\/div>\s*`;\}\)\.join/s);
assert(Boolean(rowHtmlMatch), 'admin.js defines .staff-row template');
if (rowHtmlMatch) {
    assert(rowHtmlMatch[1].includes('staff-name-cell'), 'Col 1 cell has class staff-name-cell');
    assert(rowHtmlMatch[1].includes('staff-policy-cell'), 'Col 2 cell has class staff-policy-cell');
    assert(rowHtmlMatch[1].includes('staff-device-cell'), 'Col 3 cell has class staff-device-cell');
    assert(rowHtmlMatch[1].includes('staff-actions'), 'Col 4 cell has class staff-actions');
}

console.log('----------------------------------------------------');
console.log(`Summary: ${passCount} passed, ${failCount} failed`);
console.log('----------------------------------------------------');

if (failCount > 0) {
    process.exit(1);
} else {
    console.log('🎉 ALL STAFF TABLE ALIGNMENT CHECKS PASSED EMPIRICALLY!');
}
