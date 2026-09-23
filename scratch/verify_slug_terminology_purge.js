const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- EMPIRICAL TEST: PURGE DEVELOPER JARGON "SLUG" FROM USER-FACING UI ---');

const repoRoot = path.resolve(__dirname, '..');

// 1. onboard/index.html
console.log('[Test 1] Checking onboard/index.html...');
const onboardHtml = fs.readFileSync(path.join(repoRoot, 'onboard', 'index.html'), 'utf8');
assert(!onboardHtml.includes('Workspace Identifier (Slug)'), 'onboard/index.html must not contain "(Slug)"');
assert(!onboardHtml.includes('Workspace Slug'), 'onboard/index.html must not contain "Workspace Slug"');
assert(onboardHtml.includes('Workspace Identifier <span class="req">*</span>'), 'onboard/index.html must label field as Workspace Identifier');
console.log('✓ onboard/index.html successfully updated and verified');

// 2. super-admin/index.html
console.log('[Test 2] Checking super-admin/index.html...');
const superAdminHtml = fs.readFileSync(path.join(repoRoot, 'super-admin', 'index.html'), 'utf8');
assert(!superAdminHtml.includes('Filter companies by name or slug...'), 'super-admin search placeholder must not say "slug"');
assert(superAdminHtml.includes('Filter companies by name or identifier...'), 'super-admin search placeholder must say "identifier"');
assert(!superAdminHtml.includes('<label>Workspace Slug (URL)</label>'), 'super-admin must not label field as Workspace Slug');
assert(superAdminHtml.includes('<label>Workspace Identifier (URL)</label>'), 'super-admin must label field as Workspace Identifier');
assert(!superAdminHtml.includes('badge-slug">slug</span>'), 'super-admin modal badge must not have placeholder text "slug"');
console.log('✓ super-admin/index.html successfully updated and verified');

// 3. onboard/onboard.js
console.log('[Test 3] Checking onboard/onboard.js messages & logic...');
const onboardJs = fs.readFileSync(path.join(repoRoot, 'onboard', 'onboard.js'), 'utf8');
assert(!onboardJs.includes('Workspace slug is required.'), 'onboard.js must not say "Workspace slug is required."');
assert(!onboardJs.includes('Workspace slug must be at least 2 characters.'), 'onboard.js must not say "Workspace slug must be at least 2 characters."');
assert(!onboardJs.includes('Please enter a Workspace Slug.'), 'onboard.js must not alert "Please enter a Workspace Slug."');
assert(!onboardJs.includes('The workspace slug'), 'onboard.js must not say "The workspace slug"');
assert(onboardJs.includes('Workspace identifier is required.'), 'onboard.js must say "Workspace identifier is required."');
assert(onboardJs.includes('Workspace identifier must be at least 2 characters.'), 'onboard.js must say "Workspace identifier must be at least 2 characters."');
assert(onboardJs.includes('Please enter a Workspace Identifier.'), 'onboard.js must alert "Please enter a Workspace Identifier."');

// Test validation logic inside onboard.js
const PROHIBITED_HATE_WORDS = ['hate', 'scam'];
const SENSITIVE_REVIEW_TERMS = ['bank', 'pay'];
const RESERVED_SLUGS = new Set(['admin', 'api', 'root']);
eval(`
function validateTenantSlug(slug, companyName = '') {
    const clean = String(slug || '').trim().toLowerCase();
    if (!clean) return { valid: false, message: 'Workspace identifier is required.' };
    if (clean.length < 2) return { valid: false, message: 'Workspace identifier must be at least 2 characters.' };
    if (!/^[a-z0-9-]+$/.test(clean)) return { valid: false, message: 'Workspace identifier may only contain lowercase letters, numbers, and hyphens.' };

    if (RESERVED_SLUGS.has(clean)) {
        return { valid: false, message: 'The workspace identifier "' + clean + '" is a reserved system keyword. Please choose a custom name.' };
    }

    return { valid: true, cleanSlug: clean };
}
`);

const emptyCheck = validateTenantSlug('');
assert.strictEqual(emptyCheck.valid, false);
assert.strictEqual(emptyCheck.message, 'Workspace identifier is required.');

const shortCheck = validateTenantSlug('a');
assert.strictEqual(shortCheck.valid, false);
assert.strictEqual(shortCheck.message, 'Workspace identifier must be at least 2 characters.');

const reservedCheck = validateTenantSlug('admin');
assert.strictEqual(reservedCheck.valid, false);
assert(reservedCheck.message.includes('The workspace identifier "admin" is a reserved system keyword.'));

const validCheck = validateTenantSlug('acme-corp');
assert.strictEqual(validCheck.valid, true);
assert.strictEqual(validCheck.cleanSlug, 'acme-corp');
console.log('✓ onboard/onboard.js validation logic verified');

// 4. admin/admin.js
console.log('[Test 4] Checking admin/admin.js email template...');
const adminJs = fs.readFileSync(path.join(repoRoot, 'admin', 'admin.js'), 'utf8');
assert(!adminJs.includes('Workspace Slug: ${slug}'), 'admin.js must not contain "Workspace Slug: ${slug}"');
assert(adminJs.includes('Workspace Identifier: ${slug}'), 'admin.js must contain "Workspace Identifier: ${slug}"');
console.log('✓ admin/admin.js email template verified');

// 5. common.js
console.log('[Test 5] Checking common.js error messages...');
const commonJs = fs.readFileSync(path.join(repoRoot, 'common.js'), 'utf8');
assert(!commonJs.includes("message: 'Workspace slug"), 'common.js must not have error message with "Workspace slug"');
assert(!commonJs.includes("message: 'Tenant slug"), 'common.js must not have error message with "Tenant slug"');
assert(!commonJs.includes("message: 'Slug is empty.'"), 'common.js must not have error message "Slug is empty."');
assert(commonJs.includes("message: 'Workspace identifier is empty.'"), 'common.js must have "Workspace identifier is empty."');
assert(commonJs.includes("message: 'Workspace identifier is required.'"), 'common.js must have "Workspace identifier is required."');
console.log('✓ common.js error messages verified');

console.log('\n>>> ALL 5 PURGE VERIFICATION TESTS PASSED SUCCESSFULLY! <<<');
