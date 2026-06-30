/**
 * Staff Attendance - main page logic.
 * Depends on common.js being loaded first.
 */

const MAX_HISTORY_ITEMS = 5;
const OWNERSHIP_MODES = {
    verify: 'verify-owner',
    register: 'register-owner',
    reassign: 'reassign-owner'
};

let deviceId = '';
let coords = null;
let deferredPrompt;
let activeSubmission = null;
let syncInProgress = false;
let syncRetryTimer = null;

/* ---------- Device identity ---------- */

async function generateIdentity() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillText('Lifecard-Security-v2', 2, 15);
    const hw = btoa(canvas.toDataURL()).substr(-16, 16);
    let salt = localStorage.getItem('attendance_salt') || Math.random().toString(36).substring(2, 10);
    localStorage.setItem('attendance_salt', salt);
    return `ID-${hw}-${salt}`;
}

/* ---------- Sound feedback ---------- */

function playWindowsSound(isSuccess) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const now = audioCtx.currentTime;
        const play = (freq, start, duration) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.frequency.value = freq;
            gain.gain.value = 0.1;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(start);
            osc.stop(start + duration);
        };
        if (isSuccess) {
            play(659.25, now, 0.1);
            play(783.99, now + 0.1, 0.2);
        } else {
            play(783.99, now, 0.1);
            play(659.25, now + 0.1, 0.1);
            play(523.25, now + 0.2, 0.2);
        }
    } catch (error) {
        console.warn('Audio feedback unavailable:', error.message);
    }
}

/* ---------- Rendering ---------- */

function renderRecentLog() {
    const logList = document.getElementById('log-list');
    if (!logList) return;
    const entries = readStoredJson(STORAGE_KEYS.recentLog, []);
    if (!entries.length) {
        logList.innerHTML = '<li>No attendance yet.</li>';
        return;
    }
    logList.innerHTML = entries.slice(0, MAX_HISTORY_ITEMS).map((entry) => {
        const statusText = entry.status === 'pending' ? 'Pending sync' : entry.status === 'synced' ? 'Synced' : 'Saved offline';
        const statusClass = entry.status === 'pending' ? 'pending' : entry.status === 'synced' ? 'synced' : 'offline';
        return `<li><div><strong>${entry.name}</strong><div class="meta">${entry.action} - ${statusText}</div><span class="status-pill ${statusClass}">${statusText}</span></div><div class="meta">${formatTimestamp(entry.timestamp)}</div></li>`;
    }).join('');
}

function updateLastSyncedLabel() {
    const label = document.getElementById('last-synced');
    if (!label) return;
    const lastSynced = localStorage.getItem(STORAGE_KEYS.lastSynced);
    label.innerText = lastSynced ? `Last synced: ${lastSynced}` : 'Last synced: none';
}

function updateLastActionLabel() {
    const label = document.getElementById('last-action');
    if (!label) return;
    const lastAction = readStoredJson(STORAGE_KEYS.lastAction, null);
    if (!lastAction) {
        label.innerText = 'Last action: none yet';
        return;
    }
    const actionText = lastAction.action === 'IN' ? 'Signed in' : 'Signed out';
    label.innerText = `Last action: ${lastAction.name} - ${actionText} - ${formatTimestamp(lastAction.timestamp)}`;
}

function setMessage(text, className) {
    const msg = document.getElementById('msg');
    if (!msg) return;
    msg.style.display = 'block';
    msg.innerText = text;
    msg.className = className;
}

/* ---------- Device ownership (server-validated) ---------- */

function verifyDeviceOwnership(name) {
    return callBackend({ mode: OWNERSHIP_MODES.verify, deviceId, name: name || '' });
}

function registerDeviceOwnership(name) {
    return callBackend({ mode: OWNERSHIP_MODES.register, deviceId, name: name || '' });
}

async function reassignDeviceOwnership(newName, resetCode) {
    const resetCodeHash = await sha256Hex(resetCode);
    return callBackend({ mode: OWNERSHIP_MODES.reassign, deviceId, name: newName || '', resetCodeHash });
}

/* ---------- Local-only device hint (server is still source of truth) ---------- */

function getLocalDeviceLockHint() {
    return localStorage.getItem(STORAGE_KEYS.deviceLock);
}

function setLocalDeviceLockHint(name) {
    localStorage.setItem(STORAGE_KEYS.deviceLock, name);
}

function clearLocalDeviceLockHint() {
    localStorage.removeItem(STORAGE_KEYS.deviceLock);
}

/* ---------- Submission queue ---------- */

function saveRecentEntry(entry) {
    const entries = readStoredJson(STORAGE_KEYS.recentLog, []);
    entries.unshift(entry);
    writeStoredJson(STORAGE_KEYS.recentLog, entries.slice(0, MAX_HISTORY_ITEMS));
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

function preventDuplicateSubmission(action, name) {
    const lastAction = readStoredJson(STORAGE_KEYS.lastAction, null);
    if (!lastAction) return false;
    if (lastAction.date === getTodayKey() && lastAction.name === name) {
        if (lastAction.action === action) {
            showToast(`You already ${action === 'IN' ? 'signed in' : 'signed out'} today. Please ${action === 'IN' ? 'sign out' : 'sign in'} first.`, 'error');
            return true;
        }
    }
    return false;
}

function rememberLastAction(action, name) {
    writeStoredJson(STORAGE_KEYS.lastAction, { date: getTodayKey(), action, name, timestamp: new Date().toISOString() });
    updateLastActionLabel();
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
    setMessage('Saved offline. It will sync automatically when connection returns.', 'msg-late');
    scheduleSyncRetry(1500);
}

function removeQueuedSubmission(id) {
    const pendingQueue = readStoredJson(STORAGE_KEYS.pendingQueue, []);
    const updatedQueue = pendingQueue.filter((item) => item.id !== id);
    writeStoredJson(STORAGE_KEYS.pendingQueue, updatedQueue);
}

async function flushPendingQueue() {
    if (!navigator.onLine || syncInProgress) {
        scheduleSyncRetry();
        return;
    }
    const pendingQueue = readStoredJson(STORAGE_KEYS.pendingQueue, []);
    if (!pendingQueue.length) return;
    const next = pendingQueue[0];
    syncInProgress = true;
    activeSubmission = { name: next.name, action: next.action, lat: next.lat, lon: next.lon, pendingId: next.id };
    setMessage('Syncing queued entry...', 'msg-welcome');

    try {
        const data = await callBackend({
            mode: 'attendance',
            name: next.name,
            action: next.action,
            lat: next.lat,
            lon: next.lon,
            deviceId
        });
        await handleAttendanceResponse(data);
    } catch (error) {
        syncInProgress = false;
        activeSubmission = null;
        setMessage('Sync failed. Retrying automatically...', 'msg-late');
        scheduleSyncRetry(10000);
    }
}

function updateSignInButtonsState() {
    const name = document.getElementById('staff-name').value;
    const canUseButtons = Boolean(name) && Boolean(coords);
    document.getElementById('in-btn').disabled = !canUseButtons;
    document.getElementById('out-btn').disabled = !canUseButtons;
}

/* ---------- Submission flow ---------- */

async function submit(action) {
    const name = document.getElementById('staff-name').value;
    if (!name) {
        showToast('Please select your name first.', 'error');
        updateSignInButtonsState();
        return;
    }

    // Local hint gives instant feedback, but the server re-checks
    // this independently in processAttendance() regardless.
    const localOwner = getLocalDeviceLockHint();
    if (localOwner && localOwner !== name) {
        showToast(`This device is locked to ${localOwner}. Please use the registered device.`, 'error');
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

    setMessage('Checking device authorization...', 'msg-welcome');
    let verified;
    try {
        const response = await verifyDeviceOwnership(name);
        verified = response.allowed;
        if (!verified) {
            setMessage(response.message || 'This device is not authorized for that staff member.', 'msg-late');
        }
    } catch (error) {
        verified = false;
        setMessage('Could not verify device authorization. Check your connection.', 'msg-late');
    }

    if (!verified) {
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
    setMessage('Syncing...', 'msg-welcome');
    syncInProgress = true;
    activeSubmission = { name, action, lat: coords.lat, lon: coords.lon };

    try {
        const data = await callBackend({
            mode: 'attendance',
            name,
            action,
            lat: coords.lat,
            lon: coords.lon,
            deviceId
        });
        await handleAttendanceResponse(data);
    } catch (error) {
        syncInProgress = false;
        activeSubmission = null;
        setMessage('Sync failed. Saving offline and retrying...', 'msg-late');
        queuePendingSubmission(name, action, coords.lat, coords.lon);
        scheduleSyncRetry(10000);
    }
}

async function handleAttendanceResponse(data) {
    const resultString = (data && data.result) || (typeof data === 'string' ? data : null);
    if (!resultString) {
        setMessage('Unexpected response from server.', 'msg-late');
        syncInProgress = false;
        activeSubmission = null;
        updateSignInButtonsState();
        return;
    }

    const [status, text] = resultString.split('|');
    setMessage(text || 'Action recorded.', (status === 'WELCOME' || status === 'NORMAL') ? 'msg-welcome' : 'msg-late');
    playWindowsSound(status === 'WELCOME' || status === 'NORMAL');

    if (activeSubmission && status !== 'BLOCK') {
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

        try {
            const response = await registerDeviceOwnership(activeSubmission.name);
            if ((response.allowed || response.owner || response.message) && !getLocalDeviceLockHint()) {
                setLocalDeviceLockHint(activeSubmission.name);
            }
        } catch (error) {
            console.warn('Could not register device ownership:', error.message);
        }

        if (activeSubmission.pendingId) {
            removeQueuedSubmission(activeSubmission.pendingId);
        }
        activeSubmission = null;
    } else if (activeSubmission && activeSubmission.pendingId && status === 'BLOCK') {
        // A queued item came back blocked (e.g. duplicate sign-in) - drop it
        // rather than retrying forever.
        removeQueuedSubmission(activeSubmission.pendingId);
        activeSubmission = null;
    }

    syncInProgress = false;
    updateSignInButtonsState();
    flushPendingQueue();
}

/* ---------- Geolocation ---------- */

function requestLocation() {
    if (!navigator.geolocation) {
        document.getElementById('loc-status').innerText = 'GPS unsupported';
        showToast('This browser does not support location services.', 'error');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            document.getElementById('loc-status').innerText = 'Location Verified';
            document.getElementById('loc-status').className = 'status ready';
            updateSignInButtonsState();
            flushPendingQueue();
        },
        (err) => {
            let userMsg = 'Location access is required to sign in.';
            if (err.code === 1) {
                userMsg = 'Location access was denied. Please allow location, then refresh the page.';
            } else if (err.code === 2) {
                userMsg = 'Location service is disabled on your device. Please allow location, then refresh the page.';
            }
            document.getElementById('loc-status').innerText = 'GPS REQUIRED';
            document.getElementById('loc-status').className = 'status waiting';
            updateSignInButtonsState();
            showToast(userMsg, 'error', 5000);
        },
        { enableHighAccuracy: true }
    );
}

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
    deviceId = await generateIdentity();

    const staffNameSelect = document.getElementById('staff-name');
    const saved = localStorage.getItem('saved_name');
    if (saved && staffNameSelect) staffNameSelect.value = saved;

    if (staffNameSelect) {
        staffNameSelect.addEventListener('change', () => {
            localStorage.setItem('saved_name', staffNameSelect.value);
            updateSignInButtonsState();
        });
    }

    document.getElementById('in-btn').addEventListener('click', () => submit('IN'));
    document.getElementById('out-btn').addEventListener('click', () => submit('OUT'));

    renderRecentLog();
    updateLastActionLabel();
    updateLastSyncedLabel();
    updateSignInButtonsState();
    requestLocation();
    flushPendingQueue();
});

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

/* ---------- PWA install prompt ---------- */

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-btn');
    if (installBtn) installBtn.style.display = 'block';
});

document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
        installBtn.addEventListener('click', () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt = null;
            }
        });
    }
});
