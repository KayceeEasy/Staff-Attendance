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

/* ---------- Device identity ---------- */

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
    try {
        const db = await openDeviceIdb();
        const existing = await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (existing && existing.uuid) return existing;

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

    try {
        const lsKey = 'attendance_device_identity';
        const stored = localStorage.getItem(lsKey);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.uuid) return parsed;
            } catch (parseErr) {}
        }
        const identity = { uuid: generateUuid(), hw: computeCanvasHardwareHash() };
        localStorage.setItem(lsKey, JSON.stringify(identity));
        return identity;
    } catch (lsError) {
        console.warn('localStorage also unavailable, using session-only identity:', lsError.message);
    }

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
        const cleanName = escapeHtml(entry.name);
        const cleanAction = escapeHtml(entry.action);
        return `<li><div><strong>${cleanName}</strong><div class="meta">${cleanAction} - ${statusText}</div><span class="status-pill ${statusClass}">${statusText}</span></div><div class="meta">${formatTimestamp(entry.timestamp)}</div></li>`;
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
    label.textContent = `~${dist.toFixed(0)} meters from office`;
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

/* ---------- Local-only device hint ---------- */

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

    const lastAction = readStoredJson(STORAGE_KEYS.lastAction, null);
    if (lastAction && lastAction.date === todayKey && lastAction.name === name && lastAction.action === action) {
        showToast(`You already ${action === 'IN' ? 'signed in' : 'signed out'} today. Please ${action === 'IN' ? 'sign out' : 'sign in'} first.`, 'error');
        return true;
    }

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

function getPendingAction() {
    return readStoredJson(STORAGE_KEYS.pendingAction, null);
}

function setPendingAction(action, name) {
    writeStoredJson(STORAGE_KEYS.pendingAction, { date: getTodayKey(), action, name });
}

function clearPendingAction(action, name) {
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
        resetSyncRetryCount();
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

/* ---------- Staff dropdown ---------- */

let currentStaffList = [];
let highlightedOptionIndex = -1;

function populateStaffDropdown(names, preserveSelection = true) {
    const staffNameSelect = document.getElementById('staff-name');
    if (!staffNameSelect || !names || !names.length) return;

    const sortedNames = Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    currentStaffList = sortedNames;

    const currentValue = preserveSelection ? staffNameSelect.value : '';
    staffNameSelect.innerHTML = '<option value="">Select your name...</option>' +
        sortedNames.map((name) => `<option>${escapeHtml(name)}</option>`).join('');

    let activeName = '';
    if (currentValue && sortedNames.includes(currentValue)) {
        staffNameSelect.value = currentValue;
        activeName = currentValue;
    } else {
        const saved = localStorage.getItem('saved_name');
        if (saved && sortedNames.includes(saved)) {
            staffNameSelect.value = saved;
            activeName = saved;
        }
    }

    const searchInput = document.getElementById('staff-search-input');
    const clearBtn = document.getElementById('staff-search-clear');
    if (searchInput) {
        searchInput.value = activeName;
    }
    if (clearBtn) {
        clearBtn.style.display = activeName ? 'block' : 'none';
    }

    updateSignInButtonsState();
}

function initSearchableStaffDropdown() {
    const wrapper = document.getElementById('staff-search-wrapper');
    const input = document.getElementById('staff-search-input');
    const optionsList = document.getElementById('staff-options-list');
    const clearBtn = document.getElementById('staff-search-clear');
    const toggleBtn = document.getElementById('staff-search-toggle');
    const select = document.getElementById('staff-name');

    if (!wrapper || !input || !optionsList || !select) return;

    const initialOptions = Array.from(select.options)
        .map(opt => opt.value)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    if (initialOptions.length) {
        currentStaffList = initialOptions;
    }

    function renderOptions(filterQuery = '') {
        const query = filterQuery.trim().toLowerCase();
        const filtered = currentStaffList.filter(name => name.toLowerCase().includes(query));
        optionsList.innerHTML = '';
        highlightedOptionIndex = -1;

        if (!filtered.length) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'staff-option-empty';
            emptyLi.textContent = query ? `No staff matching "${filterQuery}"` : 'No staff available';
            optionsList.appendChild(emptyLi);
            return;
        }

        filtered.forEach((name) => {
            const li = document.createElement('li');
            li.className = 'staff-option-item' + (select.value === name ? ' selected' : '');
            li.setAttribute('role', 'option');
            li.setAttribute('data-value', name);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            li.appendChild(nameSpan);

            if (select.value === name) {
                const checkSpan = document.createElement('span');
                checkSpan.textContent = '✓';
                checkSpan.style.fontSize = '0.85rem';
                li.appendChild(checkSpan);
            }

            li.addEventListener('click', () => {
                selectStaffMember(name);
            });

            optionsList.appendChild(li);
        });
    }

    function openDropdown() {
        wrapper.classList.add('open');
        optionsList.style.display = 'block';
        input.setAttribute('aria-expanded', 'true');
        renderOptions(input.value === select.value ? '' : input.value);
    }

    function closeDropdown() {
        wrapper.classList.remove('open');
        optionsList.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
        highlightedOptionIndex = -1;
    }

    function selectStaffMember(name) {
        select.value = name;
        input.value = name;
        if (clearBtn) clearBtn.style.display = name ? 'block' : 'none';
        localStorage.setItem('saved_name', name);
        closeDropdown();
        select.dispatchEvent(new Event('change', { bubbles: true }));
        updateSignInButtonsState();
    }

    function clearSelection() {
        select.value = '';
        input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        localStorage.removeItem('saved_name');
        select.dispatchEvent(new Event('change', { bubbles: true }));
        updateSignInButtonsState();
        openDropdown();
        input.focus();
    }

    input.addEventListener('focus', () => { openDropdown(); });
    input.addEventListener('click', () => { openDropdown(); });

    input.addEventListener('input', (e) => {
        if (!wrapper.classList.contains('open')) openDropdown();
        const query = e.target.value;
        if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

        if (!query) {
            select.value = '';
            localStorage.removeItem('saved_name');
            select.dispatchEvent(new Event('change', { bubbles: true }));
            updateSignInButtonsState();
        }

        renderOptions(query);
    });

    input.addEventListener('keydown', (e) => {
        const items = Array.from(optionsList.querySelectorAll('.staff-option-item'));
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!wrapper.classList.contains('open')) { openDropdown(); return; }
            highlightedOptionIndex = (highlightedOptionIndex + 1) % items.length;
            items.forEach((item, i) => item.classList.toggle('highlighted', i === highlightedOptionIndex));
            items[highlightedOptionIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!wrapper.classList.contains('open')) return;
            highlightedOptionIndex = (highlightedOptionIndex - 1 + items.length) % items.length;
            items.forEach((item, i) => item.classList.toggle('highlighted', i === highlightedOptionIndex));
            items[highlightedOptionIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedOptionIndex >= 0 && items[highlightedOptionIndex]) {
                const val = items[highlightedOptionIndex].getAttribute('data-value');
                if (val) selectStaffMember(val);
            } else if (items[0]) {
                const val = items[0].getAttribute('data-value');
                if (val) selectStaffMember(val);
            }
        } else if (e.key === 'Escape') {
            closeDropdown();
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
        });
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (wrapper.classList.contains('open')) {
                closeDropdown();
            } else {
                openDropdown();
                input.focus();
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            closeDropdown();
            if (select.value) {
                input.value = select.value;
                if (clearBtn) clearBtn.style.display = 'block';
            } else if (!input.value) {
                if (clearBtn) clearBtn.style.display = 'none';
            }
        }
    });

    const savedName = select.value || localStorage.getItem('saved_name') || '';
    if (savedName) {
        select.value = savedName;
        input.value = savedName;
        if (clearBtn) clearBtn.style.display = 'block';
    }
}

async function loadStaffDropdown() {
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

    const localOwner = getLocalDeviceLockHint();
    if (localOwner && localOwner !== name) {
        showToast(`This device is locked to ${localOwner}. Please use the registered device.`, 'error');
        updateSignInButtonsState();
        return;
    }

    if (preventDuplicateSubmission(action, name)) {
        return;
    }

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

    if (!navigator.onLine) {
        if (!coords || !coords.lat || !coords.lon) {
            showToast('Location required. Cannot sign in without GPS.', 'error');
            updateSignInButtonsState();
            return;
        }
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
        rememberLastAction(activeSubmission.action, activeSubmission.name);
        clearPendingAction(activeSubmission.action, activeSubmission.name);

        if (activeSubmission.pendingId) {
            const updated = updateRecentEntryStatus(activeSubmission.pendingId, 'synced');
            if (!updated) {
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
        clearPendingAction(activeSubmission.action, activeSubmission.name);
        updateRecentEntryStatus(activeSubmission.pendingId, 'failed');
        removeQueuedSubmission(activeSubmission.pendingId);
        activeSubmission = null;
    } else if (activeSubmission && status === 'BLOCK') {
        activeSubmission = null;
    }

    syncInProgress = false;
    updateSignInButtonsState();
    flushPendingQueue();
}

/* ---------- Geolocation ---------- */

let locationWatchId = null;
let locationWatchErrorShown = false;
let coordsTimestamp = 0;

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
            coordsTimestamp = Date.now();
            document.getElementById('loc-status').innerText = 'Location Verified';
            document.getElementById('loc-status').className = 'status ready';
            locationWatchErrorShown = false;
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
            if (!locationWatchErrorShown) {
                locationWatchErrorShown = true;
                showToast(userMsg, 'error', 5000);
            }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
}

function getFreshCoordsForSubmit() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve(coords);
            return;
        }

        if (coords && (Date.now() - coordsTimestamp) < 10000) {
            resolve(coords);
            return;
        }

        let resolved = false;
        const done = (c) => {
            if (!resolved) {
                resolved = true;
                resolve(c);
            }
        };

        const timer = setTimeout(() => {
            done(coords);
        }, 4000);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                clearTimeout(timer);
                coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                coordsTimestamp = Date.now();
                done(coords);
            },
            () => {
                clearTimeout(timer);
                done(coords);
            },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 3500 }
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
    initSearchableStaffDropdown();
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
    deviceId = await generateIdentity();
    window._deviceId = deviceId;

    const staffNameSelect = document.getElementById('staff-name');
    if (staffNameSelect) {
        staffNameSelect.addEventListener('change', () => {
            if (staffNameSelect.value) {
                localStorage.setItem('saved_name', staffNameSelect.value);
            } else {
                localStorage.removeItem('saved_name');
            }
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

    setTimeout(() => {
        try {
            const overlays = document.querySelectorAll('.dialog-overlay, .session-timeout-overlay, #faq-modal.active');
            if (!overlays || overlays.length === 0) document.body.style.overflow = '';
        } catch (e) {}
    }, 120);

    const installBtn = document.getElementById('install-btn');

    if (installBtn) {
        installBtn.addEventListener('click', triggerInstall);
        if (!isRunningStandalone()) {
            installBtn.style.display = 'block';
        }
    }
});

/* ---------- PWA Install Prompt ---------- */

function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
}

function triggerInstall() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(({ outcome }) => {
            deferredPrompt = null;
            if (outcome !== 'accepted') {
                showToast('You can install the app anytime via the browser menu.', 'default', 4000);
            }
        });
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
        requestLocation();
        flushPendingQueue();
        loadStaffDropdown();
    }
});

if ('serviceWorker' in navigator) {
    let swRefreshPending = false;
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
    
    faqBtn.addEventListener('click', () => {
        previousActiveElement = document.activeElement;
        openFaqModal();
    });
    
    if (faqCloseBtn) {
        faqCloseBtn.addEventListener('click', closeFaqModal);
    }
    
    faqModal.addEventListener('click', (e) => {
        if (e.target === faqModal) {
            closeFaqModal();
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && faqModal.classList.contains('active')) {
            closeFaqModal();
        }
    });
    
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.closest('.faq-category').dataset.category;
            filterByCategory(category);
            
            categoryBtns.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            
            if (faqSearch) {
                faqSearch.value = '';
                isSearching = false;
            }
        });
    });
    
    if (faqSearch) {
        faqSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            isSearching = query.length > 0;
            searchFaq(query);
        });
    }
    
    questionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const answer = btn.nextElementSibling;
            const isExpanded = btn.getAttribute('aria-expanded') === 'true';
            
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
        
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
        
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
        
        if (faqSearch) {
            faqSearch.value = '';
            isSearching = false;
        }
        
        showAllSections();
        
        categoryBtns.forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        });
        const firstCategoryBtn = categoryBtns[0];
        if (firstCategoryBtn) {
            firstCategoryBtn.classList.add('active');
            firstCategoryBtn.setAttribute('aria-pressed', 'true');
        }
        
        questionBtns.forEach(btn => {
            btn.setAttribute('aria-expanded', 'false');
            const answer = btn.nextElementSibling;
            if (answer) {
                answer.classList.remove('open');
                answer.setAttribute('aria-hidden', 'true');
            }
        });
        
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
            sections.forEach(section => { section.style.display = 'block'; });
            allItems.forEach(item => { item.style.display = 'block'; });
            return;
        }
        
        sections.forEach(section => { section.style.display = 'block'; });
        
        allItems.forEach(item => {
            const question = item.querySelector('.faq-question span');
            const answer = item.querySelector('.faq-answer');
            
            if (question && answer) {
                const questionText = question.textContent.toLowerCase();
                const answerText = answer.textContent.toLowerCase();
                
                if (questionText.includes(query) || answerText.includes(query)) {
                    item.style.display = 'block';
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
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initFaqModal();
});
