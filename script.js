const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxw2NO8BwcVYdiHyZfzVFFkY_D8VTaBBuMayNcRWopDFAi0PKwiuOKXZxJXVyPZvEP0-w/exec";
const STORAGE_KEYS = {
    pendingQueue: 'attendance_pending_queue',
    recentLog: 'attendance_recent_log',
    lastSynced: 'attendance_last_synced',
    lastAction: 'attendance_last_action'
};
let deviceId = "";
let coords = null;
let deferredPrompt;
let activeSubmission = null;
let syncInProgress = false;
let syncRetryTimer = null;

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

function readStoredJson(key, fallback = []) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        return fallback;
    }
}

function writeStoredJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function formatTimestamp(isoString) {
    if (!isoString) return 'Pending';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderRecentLog() {
    const logList = document.getElementById('log-list');
    if (!logList) return;
    const entries = readStoredJson(STORAGE_KEYS.recentLog, []);
    if (!entries.length) {
        logList.innerHTML = '<li>No attendance yet.</li>';
        return;
    }

    logList.innerHTML = entries.slice(0, 6).map((entry) => {
        const statusText = entry.status === 'pending' ? 'Pending sync' : entry.status === 'synced' ? 'Synced' : 'Saved offline';
        const statusClass = entry.status === 'pending' ? 'pending' : entry.status === 'synced' ? 'synced' : 'offline';
        return `<li><div><strong>${entry.name}</strong><div class="meta">${entry.action} • ${statusText}</div><span class="status-pill ${statusClass}">${statusText}</span></div><div class="meta">${formatTimestamp(entry.timestamp)}</div></li>`;
    }).join('');
}

function updateLastSyncedLabel() {
    const label = document.getElementById('last-synced');
    if (!label) return;
    const lastSynced = localStorage.getItem(STORAGE_KEYS.lastSynced);
    label.innerText = lastSynced ? `Last synced: ${lastSynced}` : 'Last synced: none';
}

function saveRecentEntry(entry) {
    const entries = readStoredJson(STORAGE_KEYS.recentLog, []);
    entries.unshift(entry);
    writeStoredJson(STORAGE_KEYS.recentLog, entries.slice(0, 8));
    renderRecentLog();
}

function scheduleSyncRetry(delay = 8000) {
    clearTimeout(syncRetryTimer);
    if (!navigator.onLine || syncInProgress) return;
    const pendingQueue = readStoredJson(STORAGE_KEYS.pendingQueue, []);
    if (!pendingQueue.length) return;
    syncRetryTimer = setTimeout(() => {
        flushPendingQueue();
    }, delay);
}

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

function preventDuplicateSubmission(action, name) {
    const lastAction = readStoredJson(STORAGE_KEYS.lastAction, null);
    if (!lastAction) return false;
    if (lastAction.date === getTodayKey() && lastAction.name === name) {
        if (lastAction.action === action) {
            alert(`You already ${action === 'IN' ? 'signed in' : 'signed out'} today. Please ${action === 'IN' ? 'sign out' : 'sign in'} first.`);
            return true;
        }
    }
    return false;
}

function rememberLastAction(action, name) {
    writeStoredJson(STORAGE_KEYS.lastAction, { date: getTodayKey(), action, name, timestamp: new Date().toISOString() });
}

function queuePendingSubmission(name, action, lat, lon) {
    const pendingQueue = readStoredJson(STORAGE_KEYS.pendingQueue, []);
    const entry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        action,
        lat,
        lon,
        timestamp: new Date().toISOString(),
        status: 'pending'
    };
    pendingQueue.unshift(entry);
    writeStoredJson(STORAGE_KEYS.pendingQueue, pendingQueue.slice(0, 10));
    saveRecentEntry({ ...entry, status: 'pending' });
    localStorage.setItem(STORAGE_KEYS.lastSynced, 'Queued offline');
    updateLastSyncedLabel();
    document.getElementById('msg').style.display = 'block';
    document.getElementById('msg').innerText = 'Saved offline. It will sync automatically when connection returns.';
    document.getElementById('msg').className = 'msg-late';
    scheduleSyncRetry(1500);
}

function removeQueuedSubmission(id) {
    const pendingQueue = readStoredJson(STORAGE_KEYS.pendingQueue, []);
    const updatedQueue = pendingQueue.filter((item) => item.id !== id);
    writeStoredJson(STORAGE_KEYS.pendingQueue, updatedQueue);
}

function flushPendingQueue() {
    if (!navigator.onLine || syncInProgress) {
        scheduleSyncRetry();
        return;
    }
    const pendingQueue = readStoredJson(STORAGE_KEYS.pendingQueue, []);
    if (!pendingQueue.length) return;
    const next = pendingQueue[0];
    syncInProgress = true;
    activeSubmission = { name: next.name, action: next.action, lat: next.lat, lon: next.lon, pendingId: next.id };
    document.getElementById('msg').style.display = 'block';
    document.getElementById('msg').innerText = 'Syncing queued entry...';
    document.getElementById('msg').className = 'msg-welcome';
    const url = `${SCRIPT_URL}?callback=handleResponse&name=${encodeURIComponent(next.name)}&action=${next.action}&lat=${next.lat}&lon=${next.lon}&deviceId=${deviceId}`;
    const script = document.createElement('script');
    script.src = url;
    script.onerror = () => {
        syncInProgress = false;
        activeSubmission = null;
        document.getElementById('msg').style.display = 'block';
        document.getElementById('msg').innerText = 'Sync failed. Retrying automatically...';
        document.getElementById('msg').className = 'msg-late';
        scheduleSyncRetry(10000);
    };
    script.onload = () => {
        if (!activeSubmission) return;
    };
    document.body.appendChild(script);
}

function updateSignInButtonsState() {
    const name = document.getElementById('staff-name').value;
    const canUseButtons = Boolean(name) && Boolean(coords);
    document.getElementById('in-btn').disabled = !canUseButtons;
    document.getElementById('out-btn').disabled = !canUseButtons;
}

function submit(action) {
    const name = document.getElementById('staff-name').value;
    if (!name) {
        alert("Select Name");
        updateSignInButtonsState();
        return;
    }
    if (preventDuplicateSubmission(action, name)) {
        return;
    }
    if (!coords) {
        requestLocation();
        updateSignInButtonsState();
        return;
    }

    if (!navigator.onLine) {
        queuePendingSubmission(name, action, coords.lat, coords.lon);
        rememberLastAction(action, name);
        return;
    }
    
    document.getElementById('in-btn').disabled = true;
    document.getElementById('out-btn').disabled = true;
    document.getElementById('msg').style.display = "block";
    document.getElementById('msg').innerText = "Syncing...";
    syncInProgress = true;
    activeSubmission = { name, action, lat: coords.lat, lon: coords.lon };

    const url = `${SCRIPT_URL}?callback=handleResponse&name=${encodeURIComponent(name)}&action=${action}&lat=${coords.lat}&lon=${coords.lon}&deviceId=${deviceId}`;
    const script = document.createElement('script');
    script.src = url;
    script.onerror = () => {
        syncInProgress = false;
        activeSubmission = null;
        document.getElementById('msg').style.display = 'block';
        document.getElementById('msg').innerText = 'Sync failed. Retrying automatically...';
        document.getElementById('msg').className = 'msg-late';
        queuePendingSubmission(name, action, coords.lat, coords.lon);
        scheduleSyncRetry(10000);
    };
    document.body.appendChild(script);
}

function handleResponse(data) {
    const msg = document.getElementById('msg');
    const [status, text] = data.result.split('|');
    msg.innerText = text;
    msg.className = (status === 'WELCOME' || status === 'NORMAL') ? 'msg-welcome' : 'msg-late';
    playWindowsSound(status === 'WELCOME' || status === 'NORMAL');
    if (activeSubmission) {
        rememberLastAction(activeSubmission.action, activeSubmission.name);
        saveRecentEntry({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: activeSubmission.name,
            action: activeSubmission.action,
            timestamp: new Date().toISOString(),
            status: 'synced'
        });
        localStorage.setItem(STORAGE_KEYS.lastSynced, new Date().toLocaleString());
        updateLastSyncedLabel();
        if (activeSubmission.pendingId) {
            removeQueuedSubmission(activeSubmission.pendingId);
        }
        activeSubmission = null;
    }
    syncInProgress = false;
    updateSignInButtonsState();
    flushPendingQueue();
}

window.onload = async () => {
    lucide.createIcons();
    deviceId = await generateIdentity();
    const staffNameSelect = document.getElementById('staff-name');
    const saved = localStorage.getItem('saved_name');
    if (saved) staffNameSelect.value = saved;

    staffNameSelect.addEventListener('change', () => {
        localStorage.setItem('saved_name', staffNameSelect.value);
        updateSignInButtonsState();
    });

    renderRecentLog();
    updateLastSyncedLabel();
    updateSignInButtonsState();
    requestLocation();
    flushPendingQueue();
};

window.addEventListener('online', () => {
    flushPendingQueue();
});

window.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        flushPendingQueue();
    }
});

setInterval(() => {
    if (readStoredJson(STORAGE_KEYS.pendingQueue, []).length) {
        flushPendingQueue();
    }
}, 10000);

function requestLocation() {
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            // Update UI to show success
            document.getElementById('loc-status').innerText = "Location Verified";
            document.getElementById('loc-status').className = "status ready";
            updateSignInButtonsState();
            flushPendingQueue();
        },
        (err) => {
            let userMsg = "Location access is required to sign in.";
            
            // Check for specific error types
            if (err.code === 1) {
                userMsg = "Location access was denied. Please allow location, then refresh the page.";
            } else if (err.code === 2) {
                userMsg = "Location service is disabled on your device. Please allow location, then refresh the page.";
            }
            
            document.getElementById('loc-status').innerText = "GPS REQUIRED";
            document.getElementById('loc-status').style.background = "#fee2e2";
            updateSignInButtonsState();
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