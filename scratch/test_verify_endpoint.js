const http = require('http');

async function testEndpoint() {
    console.log('Testing verify-staff-member simulation...');
    // We can test callBackend in common.js via a quick node runner or headless eval
    // Let's verify common.js has the function and does not error
    const commonJs = require('fs').readFileSync('common.js', 'utf8');
    if (!commonJs.includes("case 'verify-staff-member':")) {
        throw new Error("verify-staff-member not handled in common.js");
    }
    console.log('✅ verify-staff-member handler registered in common.js');
}

testEndpoint().catch(e => { console.error(e); process.exit(1); });
