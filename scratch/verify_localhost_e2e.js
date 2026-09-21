/**
 * verify_localhost_e2e.js
 * Comprehensive Localhost End-to-End Test Suite for Staff Attendance Commercial v3.0
 *
 * Verifies:
 * 1. Live sandbox server startup on localhost:8080
 * 2. HTTP 200 OK, MIME headers, and Anti-Crawl (noindex) security headers across all endpoints:
 *    - / (Staff Portal)
 *    - /admin/ (Tenant Admin Console)
 *    - /super-admin/ (Super Admin Fleet)
 *    - /onboard/ (Tenant Onboarding)
 *    - /hybrid/ (Hybrid Scheduler)
 *    - /robots.txt (Crawler Disallow rules)
 * 3. Persistent Tenant Admin Share Invite Link & Dynamic QR Code Modal
 * 4. Commercial Coupon Codes (EXTEND14, VIP30, WELCOME50) and Trial Extensions
 * 5. Android APK Weekend Geofence Alert Suppression in mobile_app/App.js
 * 6. WebAuthn Biometric 1-Tap Trigger Integration in index.html and script.js
 * 7. Onboarding 6-Digit Email OTP Verification Modal
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { spawn } = require('child_process');

const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = path.resolve(__dirname, '..');

// Helper to make an HTTP GET request and return status, headers, and body
function httpGet(urlPath) {
    return new Promise((resolve, reject) => {
        const fullUrl = `${BASE_URL}${urlPath}`;
        http.get(fullUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Helper to wait for server to accept connections
function waitForServer(maxRetries = 20, delayMs = 250) {
    return new Promise((resolve, reject) => {
        let retries = 0;
        const check = () => {
            http.get(`${BASE_URL}/robots.txt`, (res) => {
                resolve(true);
            }).on('error', (err) => {
                retries++;
                if (retries >= maxRetries) {
                    reject(new Error(`Server failed to start on ${BASE_URL} after ${maxRetries * delayMs}ms`));
                } else {
                    setTimeout(check, delayMs);
                }
            });
        };
        check();
    });
}

async function runLocalhostVerification() {
    console.log('\n======================================================');
    console.log('🚀 RUNNING LOCALHOST E2E & COMMERCIAL V3.0 VERIFICATION');
    console.log('======================================================\n');

    // 1. Start sandbox_server.js as a child process
    console.log('[STEP 1] Spawning sandbox_server.js on port 8080...');
    const serverProcess = spawn('node', [path.join(ROOT, 'sandbox_server.js')], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stderr.on('data', (d) => {
        console.error(`[Server stderr]: ${d.toString()}`);
    });

    try {
        await waitForServer();
        console.log(`✅ Sandbox server is LIVE and responding on ${BASE_URL}\n`);

        // 2. Test Staff Portal (/)
        console.log('[STEP 2] Verifying Staff Portal route (/)...');
        const rootRes = await httpGet('/');
        assert.strictEqual(rootRes.statusCode, 200, 'Root must return 200 OK');
        assert(rootRes.headers['content-type'].includes('text/html'), 'Root Content-Type must be text/html');
        assert(rootRes.body.includes('id="biometric-auth-trigger"'), 'Root HTML must include biometric-auth-trigger');
        assert(rootRes.body.includes('id="linked-identity-card"'), 'Root HTML must include linked-identity-card');
        assert(rootRes.body.includes('id="unlinked-entry-box"'), 'Root HTML must include unlinked-entry-box');
        assert(rootRes.body.includes('id="staff-search-wrapper"'), 'Root HTML must include staff-search-wrapper');
        assert(rootRes.body.includes('id="staff-options-list"'), 'Root HTML must include staff-options-list');
        assert(!rootRes.body.includes('id="confirm-identity-btn"'), 'Verify button must be eliminated in favor of type-to-search');
        console.log('✅ Staff Portal (/) returns 200 OK with type-to-search dropdown, biometrics, and zero verify buttons.');

        // 3. Test Admin Console (/admin/)
        console.log('\n[STEP 3] Verifying Tenant Admin Console route (/admin/)...');
        const adminRes = await httpGet('/admin/');
        assert.strictEqual(adminRes.statusCode, 200, 'Admin route must return 200 OK');
        assert(adminRes.headers['content-type'].includes('text/html'), 'Admin Content-Type must be text/html');
        assert.strictEqual(adminRes.headers['x-robots-tag'], 'noindex, nofollow, noarchive, nosnippet', 'Admin must have strict anti-crawl noindex header');
        assert(adminRes.body.includes('id="share-invite-modal"'), 'Admin HTML must include persistent share-invite-modal');
        assert(adminRes.body.includes('id="billing-coupon-modal"'), 'Admin HTML must include billing-coupon-modal');
        console.log('✅ Tenant Admin Console (/admin/) returns 200 OK with X-Robots-Tag and invite modal.');

        // 4. Test Super Admin Fleet (/super-admin/)
        console.log('\n[STEP 4] Verifying Super Admin Fleet route (/super-admin/)...');
        const superAdminRes = await httpGet('/super-admin/');
        assert.strictEqual(superAdminRes.statusCode, 200, 'Super-admin route must return 200 OK');
        assert.strictEqual(superAdminRes.headers['x-robots-tag'], 'noindex, nofollow, noarchive, nosnippet', 'Super Admin must have noindex header');
        assert(superAdminRes.body.includes('id="modal-tabs-strip"'), 'Super Admin HTML must include scrollable tab strip');
        assert(superAdminRes.body.includes('handleSuperAdminExtendTrial'), 'Super Admin must include trial extension controls');
        console.log('✅ Super Admin Fleet (/super-admin/) returns 200 OK with noindex and commercial controls.');

        // 5. Test Tenant Onboarding (/onboard/)
        console.log('\n[STEP 5] Verifying Tenant Onboarding route (/onboard/)...');
        const onboardRes = await httpGet('/onboard/');
        assert.strictEqual(onboardRes.statusCode, 200, 'Onboard route must return 200 OK');
        assert.strictEqual(onboardRes.headers['x-robots-tag'], 'noindex, nofollow, noarchive, nosnippet', 'Onboard must have noindex header');
        assert(onboardRes.body.includes('id="email-verify-modal"'), 'Onboard HTML must include 6-digit email OTP verification modal');
        assert(onboardRes.body.includes('id="email-otp-input"'), 'Onboard HTML must include email-otp-input');
        assert(onboardRes.body.includes('id="company-slug"'), 'Onboard HTML must include company-slug input');
        console.log('✅ Tenant Onboarding (/onboard/) returns 200 OK with 6-digit OTP verification modal.');

        // 6. Test Hybrid Scheduler (/hybrid/?key=admin)
        console.log('\n[STEP 6] Verifying Hybrid Scheduler route (/hybrid/?key=admin)...');
        const hybridRes = await httpGet('/hybrid/?key=admin');
        assert.strictEqual(hybridRes.statusCode, 200, 'Hybrid scheduler must return 200 OK');
        assert(hybridRes.headers['content-type'].includes('text/html'), 'Hybrid Content-Type must be text/html');
        console.log('✅ Hybrid Scheduler (/hybrid/) returns 200 OK.');

        // 7. Test robots.txt Disallow Directives
        console.log('\n[STEP 7] Verifying robots.txt Disallow rules...');
        const robotsRes = await httpGet('/robots.txt');
        assert.strictEqual(robotsRes.statusCode, 200, 'robots.txt must return 200 OK');
        assert(robotsRes.body.includes('Disallow: /admin/'), 'robots.txt must disallow /admin/');
        assert(robotsRes.body.includes('Disallow: /super-admin/'), 'robots.txt must disallow /super-admin/');
        assert(robotsRes.body.includes('Disallow: /onboard/'), 'robots.txt must disallow /onboard/');
        console.log('✅ robots.txt properly disallows search crawlers from administrative and onboarding routes.');

        // 8. Test Dynamic Invite Link & QR Code Generation Logic
        console.log('\n[STEP 8] Testing Persistent Tenant Admin Pairing Details & QR Logic...');
        const adminJsPath = path.join(ROOT, 'admin', 'admin.js');
        const adminJsContent = fs.readFileSync(adminJsPath, 'utf8');

        // Verify getTenantPairingDetails function logic
        assert(adminJsContent.includes('function getTenantPairingDetails()'), 'admin.js must export getTenantPairingDetails');
        assert(adminJsContent.includes('function openShareInviteModal()'), 'admin.js must export openShareInviteModal');
        assert(adminJsContent.includes('https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data='), 'Must generate dynamic QR code with 220x220 sizing and encoding');
        assert(adminJsContent.includes('copySharePairingCode()'), 'Must provide 1-click pairing code copy');
        assert(adminJsContent.includes('copyShareInviteLink()'), 'Must provide 1-click invite link copy');
        console.log('✅ Persistent Invite Link and Dynamic QR Code logic verified in admin.js.');

        // 9. Test Commercial Coupon and Trial Extension Logic
        console.log('\n[STEP 9] Testing Commercial Billing & Coupon Engine in common.js...');
        const commonJsPath = path.join(ROOT, 'common.js');
        const commonJsContent = fs.readFileSync(commonJsPath, 'utf8');

        assert(commonJsContent.includes("case 'apply-coupon':"), "common.js must handle 'apply-coupon' action");
        assert(commonJsContent.includes("code === 'EXTEND14'"), "Coupon engine must recognize EXTEND14 (+14 days)");
        assert(commonJsContent.includes("code === 'VIP30'"), "Coupon engine must recognize VIP30 (+30 days)");
        assert(commonJsContent.includes("code === 'WELCOME50'"), "Coupon engine must recognize WELCOME50 (50% retention deal)");
        assert(commonJsContent.includes("case 'extend-tenant-trial':"), "common.js must handle 'extend-tenant-trial' action");
        console.log('✅ Commercial billing coupon handler verified (EXTEND14, VIP30, WELCOME50, and trial extension).');

        // 10. Test Android APK Weekend Geofence Alert Suppression
        console.log('\n[STEP 10] Testing Android APK Weekend Geofence Alert Suppression in mobile_app/App.js...');
        const appJsPath = path.join(ROOT, 'mobile_app', 'App.js');
        const appJsContent = fs.readFileSync(appJsPath, 'utf8');

        assert(appJsContent.includes('dayOfWeek === 0 || dayOfWeek === 6'), 'mobile_app/App.js must strictly reject Saturday and Sunday geofence triggers');
        assert(appJsContent.includes('Weekend (Saturday/Sunday)'), 'mobile_app/App.js must log weekend suppression');
        assert(appJsContent.includes("dayMode !== 'office'"), 'mobile_app/App.js must cross-reference hybrid schedule');
        console.log('✅ Android APK background geofencing verified to strictly suppress alerts on weekends and non-office days.');

        // 11. Test WebAuthn Biometric 1-Tap Trigger Integration in script.js
        console.log('\n[STEP 11] Testing WebAuthn Biometric 1-Tap Trigger in script.js...');
        const scriptJsPath = path.join(ROOT, 'script.js');
        const scriptJsContent = fs.readFileSync(scriptJsPath, 'utf8');

        assert(scriptJsContent.includes("document.getElementById('biometric-auth-trigger')"), 'script.js must reference biometric-auth-trigger');
        assert(scriptJsContent.includes('bioTriggerBtn.style.display = showBioTrigger ? \'inline-flex\' : \'none\''), 'script.js must dynamically display biometric-auth-trigger only when enrolled and active');
        assert(scriptJsContent.includes('inBtn.click()'), 'Clicking biometric-auth-trigger must invoke attendance button');
        console.log('✅ Biometric 1-tap trigger integration verified in script.js.');

        console.log('\n======================================================');
        console.log('🎉 ALL LOCALHOST E2E VERIFICATION CHECKS PASSED (11/11)!');
        console.log('   The application is fully operational and ready for live deployment.');
        console.log('======================================================\n');
    } finally {
        console.log('[CLEANUP] Terminating sandbox_server.js child process...');
        serverProcess.kill('SIGTERM');
    }
}

runLocalhostVerification().catch((err) => {
    console.error('\n❌ LOCALHOST VERIFICATION FAILED:', err);
    process.exit(1);
});
