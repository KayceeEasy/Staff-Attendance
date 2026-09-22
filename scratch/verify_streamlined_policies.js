const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('====================================================');
console.log('🧪 VERIFYING STREAMLINED WORK POLICIES EMPIRICALLY');
console.log('====================================================');

const adminJs = fs.readFileSync(path.join(__dirname, '../admin/admin.js'), 'utf8');
const scriptJs = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const commonJs = fs.readFileSync(path.join(__dirname, '../common.js'), 'utf8');

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

// ─── 1. UI SELECT OPTIONS IN ADMIN CONSOLE ───
console.log('\n--- 1. Testing Admin Dropdown Streamlining ---');

// #new-staff-policy HTML options
const newStaffPolicyMatch = adminJs.match(/<select id="new-staff-policy"[^>]*>(.*?)<\/select>/s);
assert(Boolean(newStaffPolicyMatch), 'admin.js defines #new-staff-policy select element');
if (newStaffPolicyMatch) {
    const optionsHtml = newStaffPolicyMatch[1];
    const optionMatches = optionsHtml.match(/<option value="([^"]+)">([^<]+)<\/option>/g) || [];
    assert(optionMatches.length === 3, `New staff policy dropdown has exactly 3 clean options (found ${optionMatches.length})`);
    assert(optionsHtml.includes('value="weekly_hybrid">Hybrid</option>'), 'Option 1 is Hybrid (weekly_hybrid)');
    assert(optionsHtml.includes('value="field_flexible">Flexible / Remote</option>'), 'Option 2 is Flexible / Remote (field_flexible)');
    assert(optionsHtml.includes('value="office_only">On-site Only</option>'), 'Option 3 is On-site Only (office_only)');
    assert(!optionsHtml.includes('value="executive"'), 'Executive removed from dropdown choices to avoid confusion');
}

// handleEditStaff options
const editDialogMatch = adminJs.match(/label:\s*'Work Policy',\s*type:\s*'select',\s*value:[^,]+,\s*options:\s*\[(.*?)\]/s);
assert(Boolean(editDialogMatch), 'admin.js defines handleEditStaff Work Policy select options');
if (editDialogMatch) {
    const editOpts = editDialogMatch[1];
    const count = (editOpts.match(/value:/g) || []).length;
    assert(count === 3, `Edit staff dialog has exactly 3 clean options (found ${count})`);
    assert(editOpts.includes("value: 'weekly_hybrid'"), 'Edit dialog includes weekly_hybrid');
    assert(editOpts.includes("value: 'field_flexible'"), 'Edit dialog includes field_flexible');
    assert(editOpts.includes("value: 'office_only'"), 'Edit dialog includes office_only');
    assert(!editOpts.includes("value: 'executive'"), 'Edit dialog excludes redundant executive option');
}

// ─── 2. POLICY LABELS & BACKWARD COMPATIBILITY ───
console.log('\n--- 2. Testing policyLabels & Backward Compatibility ---');
const labelsMatch = adminJs.match(/const policyLabels = \{([\s\S]*?)\n\s*\};/);
assert(Boolean(labelsMatch), 'admin.js defines policyLabels catalog');
if (labelsMatch) {
    const sandbox = {};
    vm.createContext(sandbox);
    const policyLabels = vm.runInContext(`({ ${labelsMatch[1]} })`, sandbox);
    
    assert(policyLabels.weekly_hybrid?.label === 'Hybrid', 'weekly_hybrid displays as Hybrid');
    assert(policyLabels.field_flexible?.label === 'Flexible / Remote', 'field_flexible displays as Flexible / Remote');
    assert(policyLabels.executive?.label === 'Flexible / Remote', 'executive backward-compatibly displays as Flexible / Remote');
    assert(policyLabels.office_only?.label === 'On-site Only', 'office_only displays as On-site Only');
}

// ─── 3. CSV PARSER STREAMLINING ───
console.log('\n--- 3. Testing CSV Parser Auto-Mapping ---');
assert(adminJs.includes("rawPolicy.includes('flex') || rawPolicy.includes('remote')"), 'CSV parser maps flexible and remote keywords');
assert(adminJs.includes("rawPolicy.includes('site') || rawPolicy.includes('onsite')"), 'CSV parser maps onsite keywords');

// ─── 4. SCRIPT.JS RUNTIME VERIFICATION ───
console.log('\n--- 4. Testing script.js Runtime Policy Handling ---');
assert(scriptJs.includes("policy === 'field_flexible' || policy === 'executive' || policy === 'flexible_remote'"), 'script.js seamlessly treats field_flexible and legacy executive as flexible / remote');
assert(scriptJs.includes("t('flexibleMode', '🏠 Flexible / Remote')"), 'script.js sets flexibleMode text');
assert(scriptJs.includes("t('officeRequired', '📍 On-site (Required)')"), 'script.js sets officeRequired text');

// ─── 5. DICTIONARY DEFINITION VERIFICATION ───
console.log('\n--- 5. Testing I18N Dictionaries for Streamlined Labels ---');
const vmBox = {
    console,
    safeStorage: { getItem: () => 'en', setItem: () => {} },
    localStorage: { getItem: () => 'en', setItem: () => {} },
    document: { documentElement: { lang: 'en', dir: 'ltr' }, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {} },
    window: { dispatchEvent: () => {} },
    CustomEvent: function(n) { this.name = n; }
};
vm.createContext(vmBox);
vm.runInContext(commonJs, vmBox);
const { I18N_DICTIONARY } = vm.runInContext('({ I18N_DICTIONARY })', vmBox);

['en', 'es', 'fr', 'pt', 'ar'].forEach(lang => {
    const d = I18N_DICTIONARY[lang];
    assert(Boolean(d.flexibleMode), `Language '${lang}' defines flexibleMode: "${d.flexibleMode}"`);
    assert(Boolean(d.officeRequired), `Language '${lang}' defines officeRequired: "${d.officeRequired}"`);
});

console.log('\n====================================================');
console.log(`🏁 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('====================================================\n');

if (failCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
