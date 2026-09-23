const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function testHybridAndSuperAdmin() {
    console.log('[TEST] Starting empirical verification using Node.js built-in vm sandbox...');

    const mockElement = {
        style: {},
        addEventListener: () => {},
        removeEventListener: () => {},
        textContent: '',
        value: '',
        appendChild: () => {},
        setAttribute: () => {},
        getAttribute: () => null,
        classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
        querySelectorAll: () => [],
        querySelector: () => null
    };

    // 1. Simulate browser window sandbox
    const sandbox = {
        window: {},
        document: {
            documentElement: { setAttribute: () => {}, getAttribute: () => 'light' },
            body: { classList: { add: () => {}, remove: () => {} } },
            getElementById: (id) => ({ ...mockElement, id }),
            querySelector: () => mockElement,
            querySelectorAll: () => [],
            addEventListener: () => {},
            title: ''
        },
        sessionStorage: {
            getItem: (k) => null,
            setItem: (k, v) => {}
        },
        localStorage: {
            getItem: (k) => null,
            setItem: (k, v) => {}
        },
        URLSearchParams: function() {
            return { get: () => null };
        },
        location: { search: '' },
        console: { log: () => {}, warn: () => {}, error: () => {} },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Date: Date
    };
    sandbox.window = sandbox;

    const context = vm.createContext(sandbox);

    // Read common.js and hybrid/script.js
    const commonJs = fs.readFileSync(path.join(__dirname, '..', 'common.js'), 'utf8');
    const hybridJs = fs.readFileSync(path.join(__dirname, '..', 'hybrid', 'script.js'), 'utf8');
    const superAdminJs = fs.readFileSync(path.join(__dirname, '..', 'super-admin', 'super_admin.js'), 'utf8');

    // Execute common.js in context
    try {
        vm.runInContext(commonJs, context);
        console.log('✅ [PASS] common.js loaded cleanly in context');
    } catch (err) {
        console.error('❌ [FAIL] common.js execution error:', err);
        process.exit(1);
    }

    // Execute hybrid/script.js in the SAME context
    try {
        vm.runInContext(hybridJs, context);
        console.log('✅ [PASS] hybrid/script.js loaded cleanly in same context (0 duplicate declaration errors)');
    } catch (err) {
        console.error('❌ [FAIL] hybrid/script.js execution error:', err);
        process.exit(1);
    }

    // Verify hybrid functions exist
    const hasFilter = typeof sandbox.filterByDepartment === 'function';
    const hasInitBranding = typeof sandbox.initTenantHybridBranding === 'function';
    console.log(`✅ [PASS] filterByDepartment defined: ${hasFilter}`);
    console.log(`✅ [PASS] initTenantHybridBranding defined: ${hasInitBranding}`);

    // Execute super_admin.js in context
    try {
        vm.runInContext(superAdminJs, context);
        console.log('✅ [PASS] super_admin.js loaded cleanly in context');
    } catch (err) {
        console.error('❌ [FAIL] super_admin.js execution error:', err);
        process.exit(1);
    }

    // Verify Master Key Verification logic
    const validDefault = await sandbox.verifyMasterKey('ChckpointMaster2026!');
    const validLegacy = await sandbox.verifyMasterKey('LifecardMaster2026!');
    const invalidKey = await sandbox.verifyMasterKey('WrongKey123!');

    console.log(`✅ [PASS] verifyMasterKey('ChckpointMaster2026!') => ${validDefault} (expected: true)`);
    console.log(`✅ [PASS] verifyMasterKey('LifecardMaster2026!') => ${validLegacy} (expected: true)`);
    console.log(`✅ [PASS] verifyMasterKey('WrongKey123!') => ${invalidKey} (expected: false)`);

    if (validDefault && validLegacy && !invalidKey && hasFilter && hasInitBranding) {
        console.log('\n🎉 ALL EMPIRICAL RUNTIME CHECKS PASSED WITH ZERO ERRORS!');
    } else {
        console.error('❌ One or more runtime assertions failed.');
        process.exit(1);
    }
}

testHybridAndSuperAdmin().catch(err => {
    console.error('Unexpected error during testing:', err);
    process.exit(1);
});
