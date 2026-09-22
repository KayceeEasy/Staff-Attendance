const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('====================================================');
console.log('🧪 VERIFYING i18n MULTI-LANGUAGE SYSTEM EMPIRICALLY');
console.log('====================================================');

const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const adminIndexHtml = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
const scriptJs = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const commonJs = fs.readFileSync(path.join(__dirname, '../common.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');

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

// ─── 1. HTML STRUCTURE & ATTRIBUTE CHECKS ───
console.log('\n--- 1. Testing HTML Structure & i18n Bindings ---');
assert(indexHtml.includes('class="lang-selector-wrap"'), 'index.html contains .lang-selector-wrap container');
assert(indexHtml.includes('id="lang-select-btn"'), 'index.html contains #lang-select-btn');
assert(indexHtml.includes('id="lang-dropdown-menu"'), 'index.html contains #lang-dropdown-menu');
assert(indexHtml.includes('data-lang="en"'), 'index.html offers English option');
assert(indexHtml.includes('data-lang="es"'), 'index.html offers Español option');
assert(indexHtml.includes('data-lang="fr"'), 'index.html offers Français option');
assert(indexHtml.includes('data-lang="pt"'), 'index.html offers Português option');
assert(indexHtml.includes('data-lang="ar"'), 'index.html offers العربية option');
assert(indexHtml.includes('data-i18n="appName"'), 'index.html binds appName to tenant header');
assert(indexHtml.includes('data-i18n="verifyingGps"'), 'index.html binds verifyingGps to status pill');
assert(indexHtml.includes('data-i18n-placeholder="typeSearchName"'), 'index.html binds typeSearchName to search input placeholder');
assert(indexHtml.includes('data-i18n="signIn"'), 'index.html binds signIn to hero button text');
assert(indexHtml.includes('data-i18n="connectWorkspaceTitle"'), 'index.html binds connectWorkspaceTitle to workspace modal');

assert(adminIndexHtml.includes('class="lang-selector-wrap"'), 'admin/index.html contains .lang-selector-wrap');
assert(adminIndexHtml.includes('data-i18n="adminLogin"'), 'admin/index.html binds adminLogin title');
assert(adminIndexHtml.includes('data-i18n-placeholder="adminEmail"'), 'admin/index.html binds adminEmail placeholder');
assert(adminIndexHtml.includes('data-i18n-placeholder="password"'), 'admin/index.html binds password placeholder');
assert(adminIndexHtml.includes('data-i18n="logIn"'), 'admin/index.html binds logIn button');
assert(adminIndexHtml.includes('data-i18n="backToAttendance"'), 'admin/index.html binds backToAttendance link');

// ─── 2. CSS STYLING & RTL RULES ───
console.log('\n--- 2. Testing CSS & RTL Styles ---');
assert(styleCss.includes('.lang-selector-wrap'), 'style.css defines .lang-selector-wrap');
assert(styleCss.includes('.lang-btn'), 'style.css defines .lang-btn');
assert(styleCss.includes('.lang-dropdown-menu'), 'style.css defines .lang-dropdown-menu');
assert(styleCss.includes('.lang-option-btn'), 'style.css defines .lang-option-btn');
assert(styleCss.includes(':root[dir="rtl"]'), 'style.css defines :root[dir="rtl"] layout handling');
assert(styleCss.includes(':root[dir="rtl"] .topbar-brand'), 'style.css mirrors topbar brand in RTL');
assert(styleCss.includes(':root[dir="rtl"] .lang-dropdown-menu'), 'style.css positions dropdown menu to left in RTL');

// ─── 3. SCRIPT.JS INTEGRATION & EVENT LISTENERS ───
console.log('\n--- 3. Testing script.js Dynamic Translation & Event Hooks ---');
assert(scriptJs.includes("t('signIn'"), 'script.js uses t() for SIGN IN hero state');
assert(scriptJs.includes("t('signOut'"), 'script.js uses t() for SIGN OUT hero state');
assert(scriptJs.includes("t('signOutRemote'"), 'script.js uses t() for SIGN OUT (REMOTE)');
assert(scriptJs.includes("t('onLeave'"), 'script.js uses t() for ON LEAVE state');
assert(scriptJs.includes("t('completed'"), 'script.js uses t() for COMPLETED state');
assert(scriptJs.includes("window.addEventListener('languageChanged'"), 'script.js listens to languageChanged event');

// ─── 4. RUNTIME DICTIONARY & LOGIC VERIFICATION (via Node VM) ───
console.log('\n--- 4. Testing Runtime i18n Engine via Node VM ---');

const mockStorage = {};
const mockDoc = {
    documentElement: { lang: 'en', dir: 'ltr' },
    elements: [],
    querySelectorAll(selector) {
        return mockDoc.elements.filter(el => {
            if (selector === '[data-i18n]') return el.attributes['data-i18n'] !== undefined;
            if (selector === '[data-i18n-placeholder]') return el.attributes['data-i18n-placeholder'] !== undefined;
            if (selector.includes('.current-lang-flag')) return el.classList.includes('current-lang-flag');
            if (selector.includes('.current-lang-code')) return el.classList.includes('current-lang-code');
            if (selector === '.lang-option-btn') return el.classList.includes('lang-option-btn');
            if (selector === '.lang-selector-wrap') return el.classList.includes('lang-selector-wrap');
            return false;
        });
    },
    getElementById(id) {
        return mockDoc.elements.find(el => el.id === id) || null;
    },
    addEventListener() {}
};

function createElement(id, classList = [], attributes = {}) {
    const el = {
        id,
        classList,
        attributes,
        textContent: '',
        placeholder: '',
        style: {},
        getAttribute(attr) { return this.attributes[attr]; },
        setAttribute(attr, val) { this.attributes[attr] = val; },
        classList: {
            classes: classList,
            add(c) { if (!this.classes.includes(c)) this.classes.push(c); },
            remove(c) { this.classes = this.classes.filter(x => x !== c); },
            includes(c) { return this.classes.includes(c); }
        }
    };
    mockDoc.elements.push(el);
    return el;
}

// Setup mock elements representing index.html
const brandEl = createElement('tenant-brand-name', [], { 'data-i18n': 'appName' });
const statusEl = createElement('loc-status', [], { 'data-i18n': 'verifyingGps' });
const heroBtnEl = createElement('in-btn-text', [], { 'data-i18n': 'signIn' });
const searchEl = createElement('staff-search-input', [], { 'data-i18n-placeholder': 'typeSearchName' });
const flagEl = createElement('current-lang-flag', ['current-lang-flag']);
const codeEl = createElement('current-lang-code', ['current-lang-code']);

const sandbox = {
    console,
    safeStorage: {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = v; }
    },
    localStorage: {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = v; }
    },
    document: mockDoc,
    window: {
        dispatchEvent: () => {}
    },
    CustomEvent: function(name, opts) { this.name = name; this.detail = opts.detail; },
    setTimeout,
    clearTimeout
};

vm.createContext(sandbox);

// Execute common.js in the sandbox
try {
    vm.runInContext(commonJs, sandbox);
    assert(true, 'common.js executed in sandbox with zero syntax errors');
} catch (e) {
    assert(false, `common.js failed execution: ${e.message}`);
}

const exported = vm.runInContext('({ I18N_DICTIONARY, LANG_CONFIG, setAppLanguage, getAppLanguage, t })', sandbox);
const { I18N_DICTIONARY, LANG_CONFIG, setAppLanguage, getAppLanguage, t } = exported;

assert(Boolean(I18N_DICTIONARY), 'I18N_DICTIONARY is exposed');
assert(Boolean(LANG_CONFIG), 'LANG_CONFIG is exposed');

const expectedLanguages = ['en', 'es', 'fr', 'pt', 'ar'];
const requiredKeys = [
    'appName', 'verifyingGps', 'officeRequired', 'officeMode', 'homeMode',
    'flexibleMode', 'executiveMode', 'signIn', 'signOut', 'signOutRemote',
    'remoteActive', 'typeSearchName', 'switchWorkspace', 'connectWorkspaceTitle',
    'connectWorkspaceDesc', 'connectWorkspaceBtn', 'scanQrBtn', 'cancelScan',
    'cameraBlockedNotice', 'tryCameraAgain', 'switchAccount', 'deviceBound',
    'biometricsBadge', 'adminLogin', 'quickGuide', 'toggleTheme', 'refresh',
    'onLeave', 'completed', 'adminEmail', 'password', 'logIn', 'forgotPassword',
    'backToAttendance'
];

expectedLanguages.forEach(lang => {
    assert(Boolean(I18N_DICTIONARY[lang]), `Dictionary exists for language '${lang}'`);
    const dict = I18N_DICTIONARY[lang] || {};
    const missing = requiredKeys.filter(k => !dict[k]);
    assert(missing.length === 0, `Language '${lang}' has all ${requiredKeys.length} keys (missing: ${missing.join(', ')})`);
});

// Test Language Switching Mechanics & RTL
console.log('\n--- 5. Testing Language Switching, Storage & RTL Mutations ---');

// Spanish
setAppLanguage('es');
assert(getAppLanguage() === 'es', 'getAppLanguage() returns es');
assert(mockDoc.documentElement.lang === 'es', 'documentElement.lang updated to es');
assert(mockDoc.documentElement.dir === 'ltr', 'documentElement.dir is ltr for es');
assert(brandEl.textContent === 'Asistencia de Personal', 'brandEl translated to Spanish');
assert(heroBtnEl.textContent === 'REGISTRAR ENTRADA', 'heroBtnEl translated to Spanish');
assert(searchEl.placeholder === 'Escribe para buscar tu nombre...', 'searchEl placeholder translated to Spanish');
assert(flagEl.textContent === '🇪🇸', 'Flag updated to 🇪🇸');
assert(codeEl.textContent === 'ES', 'Code updated to ES');

// Arabic (RTL)
setAppLanguage('ar');
assert(getAppLanguage() === 'ar', 'getAppLanguage() returns ar');
assert(mockDoc.documentElement.lang === 'ar', 'documentElement.lang updated to ar');
assert(mockDoc.documentElement.dir === 'rtl', 'documentElement.dir updated to rtl for Arabic');
assert(brandEl.textContent === 'حضور الموظفين', 'brandEl translated to Arabic');
assert(heroBtnEl.textContent === 'تسجيل الدخول', 'heroBtnEl translated to Arabic');
assert(flagEl.textContent === '🇸🇦', 'Flag updated to 🇸🇦');
assert(codeEl.textContent === 'AR', 'Code updated to AR');

// French
setAppLanguage('fr');
assert(getAppLanguage() === 'fr', 'getAppLanguage() returns fr');
assert(mockDoc.documentElement.dir === 'ltr', 'documentElement.dir reverted to ltr for French');
assert(brandEl.textContent === 'Présence du Personnel', 'brandEl translated to French');
assert(flagEl.textContent === '🇫🇷', 'Flag updated to 🇫🇷');

// Portuguese
setAppLanguage('pt');
assert(getAppLanguage() === 'pt', 'getAppLanguage() returns pt');
assert(brandEl.textContent === 'Presença de Funcionários', 'brandEl translated to Portuguese');
assert(flagEl.textContent === '🇵🇹', 'Flag updated to 🇵🇹');

// English
setAppLanguage('en');
assert(getAppLanguage() === 'en', 'getAppLanguage() returns en');
assert(brandEl.textContent === 'Staff Attendance', 'brandEl restored to English');
assert(heroBtnEl.textContent === 'SIGN IN', 'heroBtnEl restored to English');
assert(flagEl.textContent === '🇬🇧', 'Flag updated to 🇬🇧');

console.log('\n====================================================');
console.log(`🏁 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('====================================================\n');

if (failCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
