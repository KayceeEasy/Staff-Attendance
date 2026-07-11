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
   Uses IndexedDB as the primary persistence layer for the device identity
   because it survives cache clears, cookie clears, and service worker
   updates — unlike localStorage which is wiped by those operations.
   Falls back to localStorage if IndexedDB is unavailable, and falls
   back further to a session-only identity if both fail.

   The canvas "hardware" component is generated ONCE, at the same time as
   the UUID, and persisted together with it — never recomputed on later
   loads. Canvas rendering output is not guaranteed to stay byte-identical
   forever on the same physical device (browser/OS updates, GPU driver
   changes, and increasingly common anti-fingerprinting randomization can
   all shift it slightly), so recomputing it fresh every load and folding
   it directly into the identity string that the server compares with
   strict equality would eventually make the SAME device present a
   DIFFERENT id and get incorrectly flagged as a mismatch. Fixing it once
   at creation keeps the extra entropy without that instability. */

const IDB_NAME = 'lifecard_attendance';
const IDB_STORE = 'device';
const IDB_KEY = 'identity';

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

function generateUuid() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b, i) => ([4, 6, 8, 10].includes(i) ? (b & 0x3f | 0x80).toString(16) : b.toString(16)).padStart(2, '0'))
            .join('');
}

function computeCanvasHardwareHash() {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = "14px 'Arial'";
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillText('Lifecard-Security-v2', 2, 15);
        return btoa(canvas.toDataURL()).slice(-8);
    } catch (canvasError) {
        console.warn('Canvas fingerprinting unavailable:', canvasError.message);
        return 'xx';
    }
}

async function getOrCreateDeviceIdentity() {
    // Try IndexedDB first (most durable — survives cache/cookie clears)
    try {
        const db = await openDeviceIdb();
        const existing = await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (existing && existing.uuid) return existing;

        // Not found — generate the uuid and canvas hash together, ONCE,
        // and persist both so neither ever changes again for this device.
        const identity = { uuid: generateUuid(), hw: computeCanvasHardwareHash() };

        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(identity, IDB_KEY);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        return identity;
    } catch (idbError) {
        console.warn('IndexedDB unavailable, falling back to localStorage:', idbError.message);
    }

    // Fallback: localStorage
    try {
        const lsKey = 'attendance_device_identity';
        const stored = localStorage.getItem(lsKey);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.uuid) return parsed;
            } catch (parseErr) {
                // Malformed stored value — fall through and regenerate below.
            }
        }
        const identity = { uuid: generateUuid(), hw: computeCanvasHardwareHash() };
        localStorage.setItem(lsKey, JSON.stringify(identity));
        return identity;
    } catch (lsError) {
        console.warn('localStorage also unavailable, using session-only identity:', lsError.message);
    }

    // Last resort: session-only, regenerated every load. Still uses
    // crypto.getRandomValues() (via generateUuid) rather than Math.random(),
    // even though this path only triggers when both storage layers are
    // unavailable — extremely rare, but no reason to use weaker entropy
    // just because it's a fallback.
    return { uuid: generateUuid(), hw: 'xx' };
}

async function generateIdentity() {
    try {
        const { uuid, hw } = await getOrCreateDeviceIdentity();
        return `ID-${hw || 'xx'}-${uuid}`;
    } catch (error) {
        console.warn('generateIdentity failed completely, using fallback:', error.message);
        const emergencyUuid = (window.crypto && crypto.getRandomValues)
            ? Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('')
            : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        return `ID-xx-${emergencyUuid}`;
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
        const statusText = entry.status === 'pending' ? 'Pending sync'
            : entry.status === 'synced' ? 'Synced'
            : entry.status === 'failed' ? 'Not synced'
            : 'Saved offline';
        const statusClass = entry.status === 'pending' ? 'pending'
            : entry.status === 'synced' ? 'synced'
            : 'offline';
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

// Updates an EXISTING recent-log entry in place by id, instead of adding a
// new one. This is what was missing before: once a queued offline entry
// was created with status 'pending', nothing ever went back and changed
// that SAME entry to 'synced' -- a brand new entry was added on success
// instead, leaving the original sitting there still labeled "Pending sync"
// indefinitely, even though the sign-in had actually gone through.
function updateRecentEntryStatus(id, status) {
    const entries = readStoredJson(STORAGE_KEYS.recentLog, []);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    entries[idx] = { ...entries[idx], status };
    writeStoredJson(STORAGE_KEYS.recentLog, entries);
    renderRecentLog();
    return true;
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
    const todayKey = getTodayKey();

    // A CONFIRMED action for today (the server has actually recorded it)
    // blocks the SAME action from being repeated.
    const lastAction = readStoredJson(STORAGE_KEYS.lastAction, null);
    if (lastAction && lastAction.date === todayKey && lastAction.name === name && lastAction.action === action) {
        showToast(`You already ${action === 'IN' ? 'signed in' : 'signed out'} today. Please ${action === 'IN' ? 'sign out' : 'sign in'} first.`, 'error');
        return true;
    }

    // A PENDING (queued, not yet confirmed) action for today also blocks
    // the SAME action from being queued a second time -- this stops
    // duplicate offline queuing without permanently locking the user out
    // if the pending submission later fails or gets rejected, since
    // pendingAction gets cleared on failure too (unlike lastAction).
    const pendingAction = getPendingAction();
    if (pendingAction && pendingAction.date === todayKey && pendingAction.name === name && pendingAction.action === action) {
        showToast(`Your ${action === 'IN' ? 'sign-in' : 'sign-out'} is still syncing. Please wait a moment and try again.`, 'error');
        return true;
    }

    return false;
}

function rememberLastAction(action, name) {
    writeStoredJson(STORAGE_KEYS.lastAction, { date: getTodayKey(), action, name, timestamp: new Date().toISOString() });
    updateLastActionLabel();
}

// PENDING vs CONFIRMED: lastAction (above) represents an action the
// server has actually confirmed. pendingAction represents one that's been
// queued/submitted but we don't yet know the real outcome of. Keeping
// these separate means a queued action that ultimately fails or gets
// rejected server-side never permanently poisons lastAction -- previously
// lastAction was written optimistically the moment something was queued,
// so a rejected/failed sync left the device stuck believing an action had
// succeeded when the server had no record of it at all (blocking a real
// retry, and causing the opposite action to be rejected server-side since
// there was nothing to match against).
function getPendingAction() {
    return readStoredJson(STORAGE_KEYS.pendingAction, null);
}

function setPendingAction(action, name) {
    writeStoredJson(STORAGE_KEYS.pendingAction, { date: getTodayKey(), action, name });
}

function clearPendingAction(action, name) {
    // Only clear if it still matches what we expect, so this can't
    // accidentally wipe out a DIFFERENT pending action queued in between
    // (e.g. a quick IN then OUT attempted back-to-back while offline).
    const current = getPendingAction();
    if (current && current.date === getTodayKey() && current.action === action && current.name === name) {
        localStorage.removeItem(STORAGE_KEYS.pendingAction);
    }
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

    // Force a fresh GPS reading right now, before doing anything else with
    // `coords`. This is what actually fixes location staying stuck on an
    // old off-site reading after walking into the office: previously
    // `coords` was only ever set once at page load (or on whatever cadence
    // the location watcher happened to fire), and clicking Sign In/Out just
    // reused that value as-is with no re-check at the moment of the actual
    // attempt.
    if (navigator.geolocation) {
        setMessage('Checking your current location...', 'msg-welcome');
        await getFreshCoordsForSubmit();
    }

    if (!coords) {
        requestLocation();
        updateSignInButtonsState();
        showToast('Could not get your current location. Please try again.', 'error');
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
        
        // Queue the submission - server will validate location when syncing.
        // Mark this as PENDING, not confirmed -- rememberLastAction() only
        // happens once handleAttendanceResponse() sees a real server
        // confirmation. Marking it confirmed here (the old behavior) meant
        // a submission that later failed or got rejected left the device
        // permanently stuck believing it had succeeded.
        queuePendingSubmission(name, action, coords.lat, coords.lon);
        setPendingAction(action, name);
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
        // Real, server-confirmed success -- this is the only place an
        // action gets promoted from pending to confirmed.
        rememberLastAction(activeSubmission.action, activeSubmission.name);
        clearPendingAction(activeSubmission.action, activeSubmission.name);

        if (activeSubmission.pendingId) {
            // This started as a queued offline entry. Update that SAME
            // recentLog entry to 'synced' instead of adding a duplicate --
            // previously a brand new entry was created here while the
            // original 'pending' entry was left untouched forever, which
            // is why the recent-attendance list could keep showing
            // "Pending sync" even after the sign-in had actually gone
            // through.
            const updated = updateRecentEntryStatus(activeSubmission.pendingId, 'synced');
            if (!updated) {
                // Entry somehow missing (e.g. storage was cleared meanwhile) --
                // fall back to adding a fresh one so the action is still shown.
                saveRecentEntry({
                    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    name: activeSubmission.name,
                    action: activeSubmission.action,
                    timestamp: new Date().toISOString(),
                    status: 'synced'
                });
            }
            removeQueuedSubmission(activeSubmission.pendingId);
        } else {
            // Immediate (online) submission -- no pre-existing entry for
            // this one, so add it fresh as before.
            saveRecentEntry({
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                name: activeSubmission.name,
                action: activeSubmission.action,
                timestamp: new Date().toISOString(),
                status: 'synced'
            });
        }

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

        activeSubmission = null;
    } else if (activeSubmission && activeSubmission.pendingId && status === 'BLOCK') {
        // A queued item came back blocked (e.g. duplicate sign-in, geofence
        // violation, or the situation changed by the time it finally synced).
        // Clear the PENDING marker -- not lastAction, which was never set
        // for this action in the first place -- so the user isn't locked
        // out of a real retry. Also mark the stuck recentLog entry as
        // failed instead of leaving it showing "Pending sync" forever.
        //
        // Note: geofence blocks are NOT separately reported to the analytics
        // endpoint here anymore. processAttendance() on the server already
        // writes every such block unconditionally to the "Distance Alerts"
        // sheet -- that's the authoritative record the admin's Device Events
        // view reads from. Reporting it again here was redundant (and less
        // reliable, since it depended on this exact code path running
        // successfully) and would have shown up as a duplicate entry.
        clearPendingAction(activeSubmission.action, activeSubmission.name);
        updateRecentEntryStatus(activeSubmission.pendingId, 'failed');
        removeQueuedSubmission(activeSubmission.pendingId);
        activeSubmission = null;
    } else if (activeSubmission && status === 'BLOCK') {
        // Immediate (online) submission blocked -- nothing was ever marked
        // pending or queued for this one, so there's nothing to reconcile.
        // See note above: geofence blocks are already captured server-side
        // in the Distance Alerts sheet, so no separate client report here.
        activeSubmission = null;
    }

    syncInProgress = false;
    updateSignInButtonsState();
    flushPendingQueue();
}

/* ---------- Geolocation ----------
   IMPORTANT: this uses watchPosition (continuous), not a single
   getCurrentPosition() call. The old one-shot approach captured `coords`
   ONCE at page load and then reused that same reading for every sign-in/
   out attempt for the rest of the session -- so if the page was open
   while off-site, coords stayed stale even after physically walking into
   the office, since nothing ever re-fetched it. watchPosition keeps
   coords updated automatically as the device moves. submit() ALSO forces
   one fresh getCurrentPosition() read at the exact moment of the actual
   attempt (see getFreshCoordsForSubmit), as a belt-and-braces guarantee
   against watchPosition's update cadence being too slow/throttled right
   when it matters most. */

let locationWatchId = null;
let locationWatchErrorShown = false;

function requestLocation() {
    if (!navigator.geolocation) {
        document.getElementById('loc-status').innerText = 'GPS unsupported';
        showToast('This browser does not support location services.', 'error');
        return;
    }

    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
    }

    locationWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            document.getElementById('loc-status').innerText = 'Location Verified';
            document.getElementById('loc-status').className = 'status ready';
            locationWatchErrorShown = false; // a later error (e.g. permission revoked) should alert again
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
            // watchPosition can fire its error callback repeatedly while the
            // underlying condition persists (e.g. permission still denied) --
            // only toast once per failure streak, not on every retick.
            if (!locationWatchErrorShown) {
                locationWatchErrorShown = true;
                showToast(userMsg, 'error', 5000);
            }
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
}

// Forces a genuinely fresh GPS reading right now, rather than trusting
// whatever watchPosition last happened to capture. Used at the exact
// moment Sign In/Out is pressed, since that's when accuracy actually
// matters -- not whenever the ambient watcher's last tick happened to be.
// Falls back to the current `coords` (from the watcher) if this specific
// read times out or fails, rather than blocking sign-in entirely on a
// slow/unavailable GPS fix.
function getFreshCoordsForSubmit() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve(coords);
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                resolve(coords);
            },
            () => {
                resolve(coords);
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
        );
    });
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

    // Safety: if any modal overlay was left open previously, restore scrolling when none are present
    setTimeout(() => {
        try {
            const overlays = document.querySelectorAll('.dialog-overlay, .session-timeout-overlay, #faq-modal.active');
            if (!overlays || overlays.length === 0) document.body.style.overflow = '';
        } catch (e) { /* ignore */ }
    }, 120);

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
        // Restart the location watch too, in case the OS/browser paused or
        // throttled watchPosition while the tab was backgrounded (some
        // mobile browsers do this) -- ensures location resumes updating
        // promptly once the page is visible again, rather than silently
        // sitting stale until the next natural watchPosition tick.
        requestLocation();
        flushPendingQueue();
        loadStaffDropdown();
    }
});

/* ---------- Service worker update handling ----------
   sw.js uses skipWaiting()/clients.claim(), so once a deploy bumps
   CACHE_NAME, the new worker takes control almost immediately -- but an
   already-open tab keeps running the OLD page script/DOM until it
   actually reloads. This listens for that handover and reloads
   automatically, but only once the person is genuinely idle (no recent
   taps/clicks/keys, no sync in flight, no dialog open), so a background
   update can never yank the page out from under someone mid sign-in. */
if ('serviceWorker' in navigator) {
    let swRefreshPending = false;
    // Distinguishes "a new version just took over from an older one"
    // (genuine update -- worth reloading for) from "this tab just got its
    // very first controller" (a brand-new visitor's first load also fires
    // controllerchange once, harmlessly, but there's no stale page to
    // replace yet, so reloading for it would just be an unwanted flicker).
    let hadControllerAtLoad = !!navigator.serviceWorker.controller;
    let lastActivityAt = Date.now();
    const IDLE_THRESHOLD_MS = 4000;
    const IDLE_CHECK_INTERVAL_MS = 2000;

    ['click', 'touchstart', 'keydown', 'pointerdown'].forEach((evt) => {
        document.addEventListener(evt, () => { lastActivityAt = Date.now(); }, { passive: true });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (swRefreshPending) return;
        if (!hadControllerAtLoad) {
            hadControllerAtLoad = true;
            return;
        }
        swRefreshPending = true;

        const tryReload = () => {
            const idleFor = Date.now() - lastActivityAt;
            const safeToReload = idleFor >= IDLE_THRESHOLD_MS && !syncInProgress && !document.querySelector('.dialog-overlay');
            if (safeToReload) {
                window.location.reload();
                return;
            }
            setTimeout(tryReload, IDLE_CHECK_INTERVAL_MS);
        };
        setTimeout(tryReload, IDLE_CHECK_INTERVAL_MS);
    });
}

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
