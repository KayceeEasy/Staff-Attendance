/**
 * Emergency Super Admin Master Key Reset Utility
 * 
 * Usage:
 *   node scripts/reset_master_key.js "YourNewMasterKey2026!"
 * 
 * If you ever forget the Super Admin Master Key, this tool generates
 * the cryptographic SHA-256 hash and provides the exact Supabase SQL
 * query to instantly restore access.
 */

const crypto = require('crypto');

const newKey = process.argv[2];

if (!newKey) {
    console.error('\n❌ Error: Please provide a new master key.');
    console.log('\nUsage:');
    console.log('  node scripts/reset_master_key.js "YourNewMasterKey2026!"\n');
    process.exit(1);
}

if (newKey.length < 8) {
    console.error('\n❌ Error: Master key must be at least 8 characters long for security.\n');
    process.exit(1);
}

const hash = crypto.createHash('sha256').update(newKey.trim(), 'utf8').digest('hex');

console.log('\n======================================================');
console.log('🔑 SUPER ADMIN MASTER KEY RECOVERY');
console.log('======================================================\n');
console.log(`New Master Key : ${newKey}`);
console.log(`SHA-256 Hash   : ${hash}\n`);
console.log('To update in Supabase SQL Editor, run:');
console.log('------------------------------------------------------');
console.log(`INSERT INTO app_config (key, value)`);
console.log(`VALUES ('SUPER_ADMIN_MASTER_KEY_HASH', '${hash}')`);
console.log(`ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;\n`);
console.log('Or using standard UPDATE:');
console.log(`UPDATE app_config SET value = '${hash}' WHERE key = 'SUPER_ADMIN_MASTER_KEY_HASH';`);
console.log('------------------------------------------------------\n');
console.log('Once executed, log in to /super-admin/ using your new key.\n');
