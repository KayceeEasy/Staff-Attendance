const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxw2NO8BwcVYdiHyZfzVFFkY_D8VTaBBuMayNcRWopDFAi0PKwiuOKXZxJXVyPZvEP0-w/exec";
let deviceId = "";
let coords = null;
let deferredPrompt;

async function generateIdentity() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = "top"; ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60"; ctx.fillRect(125,1,62,20);
    ctx.fillText('Lifecard-Security-v2', 2, 15);
    const hw = btoa(canvas.toDataURL()).substr(-16, 16);
    let salt = localStorage.getItem('attendance_salt') || Math.random().toString(36).substring(2, 10);
    localStorage.setItem('attendance_salt', salt);
    return `ID-${hw}-${salt}`;
}

function playWindowsSound(isSuccess) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const play = (freq, start, duration) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = freq;
        gain.gain.value = 0.1;
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(start); osc.stop(start + duration);
    };
    if (isSuccess) { play(659.25, now, 0.1); play(783.99, now + 0.1, 0.2); }
    else { play(783.99, now, 0.1); play(659.25, now + 0.1, 0.1); play(523.25, now + 0.2, 0.2); }
}

function submit(action) {
    const name = document.getElementById('staff-name').value;
    if (!name) return alert("Select Name");
    if (!coords) return requestLocation();
    
    document.getElementById('in-btn').disabled = true;
    document.getElementById('out-btn').disabled = true;
    document.getElementById('msg').style.display = "block";
    document.getElementById('msg').innerText = "Syncing...";

    const url = `${SCRIPT_URL}?callback=handleResponse&name=${encodeURIComponent(name)}&action=${action}&lat=${coords.lat}&lon=${coords.lon}&deviceId=${deviceId}`;
    const script = document.createElement('script');
    script.src = url;
    document.body.appendChild(script);
}

function handleResponse(data) {
    const msg = document.getElementById('msg');
    const [status, text] = data.result.split('|');
    msg.innerText = text;
    msg.className = (status === 'WELCOME' || status === 'NORMAL') ? 'msg-welcome' : 'msg-late';
    playWindowsSound(status === 'WELCOME' || status === 'NORMAL');
    document.getElementById('in-btn').disabled = false;
    document.getElementById('out-btn').disabled = false;
}

window.onload = async () => {
    lucide.createIcons();
    deviceId = await generateIdentity();
    const saved = localStorage.getItem('saved_name');
    if (saved) document.getElementById('staff-name').value = saved;
    requestLocation();
};

function requestLocation() {
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            // Update UI to show success
            document.getElementById('loc-status').innerText = "Location Verified";
            document.getElementById('loc-status').className = "status ready";
        },
        (err) => {
            let userMsg = "Location access is required to sign in.";
            
            // Check for specific error types
            if (err.code === 1) {
                userMsg = "Location access was denied. Please tap the 'Lock' icon in your browser URL bar and enable Location permissions, then refresh the page.";
            } else if (err.code === 2) {
                userMsg = "Location service is disabled on your device. Please turn on 'Location' or 'GPS' in settings.";
            }
            
            document.getElementById('loc-status').innerText = "GPS REQUIRED";
            document.getElementById('loc-status').style.background = "#fee2e2";
            alert(userMsg);
        },
        { enableHighAccuracy: true }
    );
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-btn').style.display = 'block';
});

document.getElementById('install-btn').addEventListener('click', () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
    }
});