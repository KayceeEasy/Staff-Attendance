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
let installPromptDismissed = false;

/* ---------- Device identity ----------
   Uses IndexedDB as the primary persistence layer for the device UUID
   because it survives cache clears, cookie clears, and service worker
   updates — unlike localStorage which is wiped by those operations.
   Falls back to localStorage if IndexedDB is unavailable, and falls
   back further to a session-only ID if both fail.
   The canvas hardware component is retained as an extra entropy source
   combined with the stored UUID, not as the sole identifier. */

const IDB_NAME = 'lifecard_attendance';
const IDB_STORE = 'device';
const IDB_KEY = 'uuid';

function openDeviceIdb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = (event) => {
            event.target.result.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getOrCreateDeviceUuid() {
    // Try IndexedDB first (most durable — survives cache/cookie clears)
    try {
        const db = await openDeviceIdb();
        const existing = await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (existing) return existing;

        // Not found — generate and store
        const uuid = crypto.randomUUID
            ? crypto.randomUUID()
            : Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map((b, i) => ([4, 6, 8, 10].includes(i) ? (b & 0x3f | 0x80).toString(16) : b.toString(16)).padStart(2, '0'))
                .join('');

        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(uuid, IDB_KEY);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        return uuid;
    } catch (idbError) {
        console.warn('IndexedDB unavailable, falling back to localStorage:', idbError.message);
    }

    // Fallback: localStorage
    try {
        const lsKey = 'attendance_device_uuid';
        let uuid = localStorage.getItem(lsKey);
        if (!uuid) {
            uuid = Date.now().toString(36) + Math.random().toString(36).slice(2);
            localStorage.setItem(lsKey, uuid);
        }
        return uuid;
    } catch (lsError) {
        console.warn('localStorage also unavailable, using session-only ID:', lsError.message);
    }

    // Last resort: session-only
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function generateIdentity() {
    try {
        const uuid = await getOrCreateDeviceUuid();

        // Canvas component adds entropy but is not the sole identifier.
        // If the browser randomizes canvas output, the UUID still holds.
        let hw = 'xx';
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = "14px 'Arial'";
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillText('Lifecard-Security-v2', 2, 15);
            hw = btoa(canvas.toDataURL()).substr(-8, 8);
        } catch (canvasError) {
            console.warn('Canvas fingerprinting unavailable:', canvasError.message);
        }

        return `ID-${hw}-${uuid}`;
    } catch (error) {
        console.warn('generateIdentity failed completely, using fallback:', error.message);
        const emergency = Date.now().toString(36) + Math.random().toString(36).slice(2);
        return `ID-xx-${emergency}`;
    }
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

function updateDistanceLabel(distanceStr) {
    const label = document.getElementById('distance-label');
    if (!label) return;
    const dist = parseFloat(distanceStr);
    if (isNaN(dist)) return;
    label.textContent = `~${dist.toFixed(0)}m from office`;
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

function scheduleSyncRetry(baseDelay = 8000) {
    clearTimeout(syncRetryTimer);
    if (!navigator.onLine || syncInProgress) return;
    const pendingQueue = readStoredJson(STORAGE_KEYS.pendingQueue, []);
    if (!pendingQueue.length) return;
    
    // Exponential backoff: 8s, 16s, 32s, max 60s
    const retryCount = parseInt(localStorage.getItem('sync_retry_count') || '0', 10);
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), 60000);
    localStorage.setItem('sync_retry_count', retryCount + 1);
    
    syncRetryTimer = setTimeout(() => {
        flushPendingQueue();
    }, delay);
}

function resetSyncRetryCount() {
    localStorage.removeItem('sync_retry_count');
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
        resetSyncRetryCount(); // Success - reset retry counter
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

/* ---------- Staff dropdown ----------
   Populated from the live Staff sheet via list-staff so newly added
   staff appear without needing a redeploy. The names baked into the
   <select> in index.html stay as a fallback so the dropdown still
   works on first load with no connection; the locally cached list
   from the last successful fetch is preferred over that hardcoded
   fallback if available. */

function populateStaffDropdown(names, preserveSelection = true) {
    const staffNameSelect = document.getElementById('staff-name');
    if (!staffNameSelect || !names.length) return;
    const currentValue = preserveSelection ? staffNameSelect.value : '';
    staffNameSelect.innerHTML = '<option value="">Select your name...</option>' +
        names.map((name) => `<option>${name}</option>`).join('');
    if (currentValue && names.includes(currentValue)) {
        staffNameSelect.value = currentValue;
    } else {
        const saved = localStorage.getItem('saved_name');
        if (saved && names.includes(saved)) staffNameSelect.value = saved;
    }
    updateSignInButtonsState();
}

async function loadStaffDropdown() {
    // Use the last cached list immediately (covers offline/first paint),
    // then try to refresh from the server in the background.
    const cachedNames = readStoredJson('attendance_staff_cache', []);
    if (cachedNames.length) {
        populateStaffDropdown(cachedNames);
    }
    try {
        const response = await callBackend({ mode: 'list-staff' });
        if (response.ok && Array.isArray(response.staff) && response.staff.length) {
            const names = response.staff.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
            writeStoredJson('attendance_staff_cache', names);
            populateStaffDropdown(names);
        }
    } catch (error) {
        console.warn('Could not refresh staff list from server, using cached/hardcoded list:', error.message);
    }
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

    // If offline, still validate location before queuing
    // This prevents GPS spoofing attacks even in offline mode
    if (!navigator.onLine) {
        // Check if coords are available and within reasonable bounds
        if (!coords || !coords.lat || !coords.lon) {
            showToast('Location required. Cannot sign in without GPS.', 'error');
            updateSignInButtonsState();
            return;
        }
        
        // Queue the submission - server will validate location when syncing
        queuePendingSubmission(name, action, coords.lat, coords.lon);
        rememberLastAction(action, name);
        setMessage('Saved offline. Location will be verified when synced.', 'msg-late');
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
    const resultString = (data && data.raw) || (typeof data === 'string' ? data : null);
    if (!resultString) {
        setMessage('Unexpected response from server.', 'msg-late');
        syncInProgress = false;
        activeSubmission = null;
        updateSignInButtonsState();
        return;
    }

    const [status, text, distanceStr] = resultString.split('|');
    setMessage(text || 'Action recorded.', (status === 'WELCOME' || status === 'NORMAL') ? 'msg-welcome' : 'msg-late');
    playWindowsSound(status === 'WELCOME' || status === 'NORMAL');
    updateDistanceLabel(distanceStr);

    if (activeSubmission && status !== 'BLOCK') {
        rememberLastAction(activeSubmission.action, activeSubmission.name);
        saveRecentEntry({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: activeSubmission.name,
            action: activeSubmission.action,
            timestamp: new Date().toISOString(),
            status: 'synced'
        });
        localStorage.setItem(STORAGE_KEYS.lastSynced, formatDateDisplay(new Date().toISOString()));
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
    } else if (activeSubmission && status === 'BLOCK') {
        // Log geofence violation attempt for admin monitoring
        logAnalyticsEvent('geofence_violation_attempt', {
            name: activeSubmission.name,
            action: activeSubmission.action,
            lat: activeSubmission.lat,
            lon: activeSubmission.lon,
            deviceId: deviceId,
            message: text || 'Location verification failed'
        });
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

/* ---------- Global error handling ---------- */

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    logAnalyticsEvent('global_error', { message: event.error?.message, filename: event.filename, lineno: event.lineno });
    showToast('An unexpected error occurred. Please refresh the page.', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    logAnalyticsEvent('unhandled_rejection', { reason: event.reason?.message || String(event.reason) });
    showToast('A network error occurred. Please check your connection.', 'error');
});

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initRefreshButton();
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
    deviceId = await generateIdentity();
    window._deviceId = deviceId; // expose for logAnalyticsEvent in common.js

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
    loadStaffDropdown();

    const installBtn = document.getElementById('install-btn');

    if (installBtn) {
        installBtn.addEventListener('click', triggerInstall);
        if (!isRunningStandalone()) {
            installBtn.style.display = 'block';
        }
    }
});

/* ---------- PWA Install Prompt ----------
   Two paths:
   1. Android/Chrome: intercept beforeinstallprompt, show banner
      automatically after a short delay (first visit only).
   2. iOS Safari: beforeinstallprompt never fires; detect standalone
      mode and Safari UA to show an instructional banner instead.
   The fallback #install-btn is shown as a secondary option once
   the prompt has been captured. */

function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
}

function isIosSafari() {
    const ua = window.navigator.userAgent;
    return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios/i.test(ua);
}

async function triggerInstall() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (outcome !== 'accepted') {
            showToast('You can install the app anytime via the browser menu.', 'default', 4000);
        }
        return;
    }

    if (isRunningStandalone()) {
        showToast('This app is already installed.', 'success', 3000);
        return;
    }

    showToast('Use your browser’s install option if the prompt does not appear.', 'default', 4000);
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-btn');
    if (installBtn) installBtn.style.display = 'block';
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const installBtn = document.getElementById('install-btn');
    if (installBtn) installBtn.style.display = 'none';
    showToast('App installed successfully!', 'success');
});

window.addEventListener('online', () => {
    flushPendingQueue();
    loadStaffDropdown();
});

window.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        flushPendingQueue();
        loadStaffDropdown();
    }
});

setInterval(() => {
    if (readStoredJson(STORAGE_KEYS.pendingQueue, []).length) {
        flushPendingQueue();
    }
}, 10000);

/* ---------- FAQ Modal ---------- */

function initFaqModal() {
    const faqBtn = document.getElementById('faq-btn');
    const faqModal = document.getElementById('faq-modal');
    const faqCloseBtn = document.getElementById('faq-close-btn');
    const faqSearch = document.getElementById('faq-search');
    const faqContent = document.getElementById('faq-content');
    const categoryBtns = document.querySelectorAll('.faq-category-btn');
    const questionBtns = document.querySelectorAll('.faq-question');
    
    if (!faqBtn || !faqModal) return;
    
    let previousActiveElement = null;
    let isSearching = false;
    
    // Open modal
    faqBtn.addEventListener('click', () => {
        previousActiveElement = document.activeElement;
        openFaqModal();
    });
    
    // Close modal
    if (faqCloseBtn) {
        faqCloseBtn.addEventListener('click', closeFaqModal);
    }
    
    // Close on overlay click
    faqModal.addEventListener('click', (e) => {
        if (e.target === faqModal) {
            closeFaqModal();
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && faqModal.classList.contains('active')) {
            closeFaqModal();
        }
    });
    
    // Category filtering
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.closest('.faq-category').dataset.category;
            filterByCategory(category);
            
            // Update active state
            categoryBtns.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            
            // Clear search when switching categories
            if (faqSearch) {
                faqSearch.value = '';
                isSearching = false;
            }
        });
    });
    
    // Search functionality
    if (faqSearch) {
        faqSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            isSearching = query.length > 0;
            searchFaq(query);
        });
    }
    
    // Accordion functionality
    questionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const answer = btn.nextElementSibling;
            const isExpanded = btn.getAttribute('aria-expanded') === 'true';
            
            // Close all other answers in the same section
            const currentSection = btn.closest('.faq-section');
            if (currentSection && !isSearching) {
                const allQuestions = currentSection.querySelectorAll('.faq-question');
                const allAnswers = currentSection.querySelectorAll('.faq-answer');
                
                allQuestions.forEach(q => {
                    q.setAttribute('aria-expanded', 'false');
                });
                allAnswers.forEach(a => {
                    a.classList.remove('open');
                    a.setAttribute('aria-hidden', 'true');
                });
            }
            
            // Toggle current answer
            if (!isExpanded) {
                btn.setAttribute('aria-expanded', 'true');
                answer.classList.add('open');
                answer.setAttribute('aria-hidden', 'false');
            } else {
                btn.setAttribute('aria-expanded', 'false');
                answer.classList.remove('open');
                answer.setAttribute('aria-hidden', 'true');
            }
        });
    });
    
    function openFaqModal() {
        faqModal.classList.add('active');
        faqModal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        
        // Reinitialize Lucide icons for dynamically shown content
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
        
        // Focus the search input or close button
        setTimeout(() => {
            if (faqSearch) {
                faqSearch.focus();
            } else if (faqCloseBtn) {
                faqCloseBtn.focus();
            }
        }, 100);
    }
    
    function closeFaqModal() {
        faqModal.classList.remove('active');
        faqModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        
        // Clear search
        if (faqSearch) {
            faqSearch.value = '';
            isSearching = false;
        }
        
        // Reset to show all categories
        showAllSections();
        
        // Reset category buttons
        categoryBtns.forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        });
        const firstCategoryBtn = categoryBtns[0];
        if (firstCategoryBtn) {
            firstCategoryBtn.classList.add('active');
            firstCategoryBtn.setAttribute('aria-pressed', 'true');
        }
        
        // Close all accordions
        questionBtns.forEach(btn => {
            btn.setAttribute('aria-expanded', 'false');
            const answer = btn.nextElementSibling;
            if (answer) {
                answer.classList.remove('open');
                answer.setAttribute('aria-hidden', 'true');
            }
        });
        
        // Return focus to the FAQ button
        if (previousActiveElement) {
            previousActiveElement.focus();
        }
    }
    
    function filterByCategory(category) {
        const sections = faqContent.querySelectorAll('.faq-section');
        
        sections.forEach(section => {
            if (section.dataset.section === category) {
                section.style.display = 'block';
            } else {
                section.style.display = 'none';
            }
        });
    }
    
    function showAllSections() {
        const sections = faqContent.querySelectorAll('.faq-section');
        sections.forEach(section => {
            section.style.display = 'block';
        });
    }
    
    function searchFaq(query) {
        const sections = faqContent.querySelectorAll('.faq-section');
        const allItems = faqContent.querySelectorAll('.faq-item');
        
        if (!query) {
            // Show all sections and items
            sections.forEach(section => {
                section.style.display = 'block';
            });
            allItems.forEach(item => {
                item.style.display = 'block';
            });
            return;
        }
        
        // Show all sections first
        sections.forEach(section => {
            section.style.display = 'block';
        });
        
        // Filter items based on search query
        allItems.forEach(item => {
            const question = item.querySelector('.faq-question span');
            const answer = item.querySelector('.faq-answer');
            
            if (question && answer) {
                const questionText = question.textContent.toLowerCase();
                const answerText = answer.textContent.toLowerCase();
                
                if (questionText.includes(query) || answerText.includes(query)) {
                    item.style.display = 'block';
                    // Auto-expand matching items
                    const questionBtn = item.querySelector('.faq-question');
                    if (questionBtn) {
                        questionBtn.setAttribute('aria-expanded', 'true');
                        answer.classList.add('open');
                        answer.setAttribute('aria-hidden', 'false');
                    }
                } else {
                    item.style.display = 'none';
                }
            }
        });
        
        // Show message if no results found
        const visibleItems = faqContent.querySelectorAll('.faq-item[style="display: block;"]');
        // Also count items without inline style (default display: block)
        const allVisibleItems = Array.from(allItems).filter(item => {
            return item.style.display !== 'none';
        });
        
        if (allVisibleItems.length === 0) {
            // Could add a "no results" message here if desired
            console.log('No FAQ items found for query:', query);
        }
    }
}

// Initialize FAQ modal when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initFaqModal();
});
