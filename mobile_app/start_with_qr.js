const qrcode = require('qrcode-terminal');
const { spawn } = require('child_process');
const os = require('os');

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('172.')) {
        return iface.address;
      }
    }
  }
  return '192.168.18.19';
}

const localIp = getLocalIp();
const expoUrl = `exp://${localIp}:8081`;

console.log('\n======================================================');
console.log('  LIFECARD MOBILE APP - EXPO SDK 54 DEV SERVER');
console.log('======================================================\n');
console.log(`📱 Expo URL for Expo Go app: ${expoUrl}\n`);
console.log('Scan the QR code below using Expo Go or Android Camera:\n');

qrcode.generate(expoUrl, { small: true });

console.log('\nStarting Metro Bundler...\n');

const metro = spawn('npx', ['expo', 'start', '--host', 'lan'], {
  stdio: 'inherit',
  shell: true
});

metro.on('error', (err) => {
  console.error('Failed to start Metro bundler:', err);
});
