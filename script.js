/**
 * Staff Attendance - main page logic.
 * Depends on common.js being loaded first.
 */

const MAX_HISTORY_ITEMS = 3;
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

const IDB_NAME = 'perimetrr_attendance';
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
        ctx.fillText('Perimetrr-Security-v2', 2, 15);
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
        const stored = safeStorage.getItem(lsKey);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.uuid) return parsed;
            } catch (parseErr) {}
        }
        const identity = { uuid: generateUuid(), hw: computeCanvasHardwareHash() };
        safeStorage.setItem(lsKey, JSON.stringify(identity));
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
        logList.innerHTML = '<li class="empty-log">No recent attendance.</li>';
        return;
    }
    logList.innerHTML = entries.slice(0, MAX_HISTORY_ITEMS).map((entry) => {
        const statusText = entry.status === 'pending' ? 'Pending'
            : entry.status === 'synced' ? 'Synced'
            : entry.status === 'failed' ? 'Failed'
            : 'Offline';
        const statusClass = entry.status === 'pending' ? 'pending'
            : entry.status === 'synced' ? 'synced'
            : 'offline';
        const cleanName = escapeHtml(entry.name);
        const cleanAction = escapeHtml(entry.action);
        const formattedTime = formatRelativeTimestamp(entry.timestamp);

        return `
            <li>
                <div class="log-left">
                    <strong class="log-name">${cleanName}</strong>
                    <span class="status-pill ${statusClass}">${statusText}</span>
                </div>
                <div class="log-right">
                    <span class="log-action ${cleanAction.toLowerCase()}">${cleanAction}</span>
                    <span class="log-time">${formattedTime}</span>
                </div>
            </li>
        `;
    }).join('');
}

function updateLastSyncedLabel() {
    const label = document.getElementById('last-synced');
    if (!label) return;
    const lastSynced = safeStorage.getItem(STORAGE_KEYS.lastSynced);
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
    label.innerText = `Last action: ${lastAction.name} - ${actionText} - ${formatRelativeTimestamp(lastAction.timestamp)}`;
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

/* ---------- Device ownership & Passkey authentication ---------- */

async function authenticateStaffWithPasskey(name) {
    if (!supabaseClient) return { ok: false, allowed: false, message: 'Client not ready' };
    
    // Check if device authorization is valid via server RPC first
    const claim = await callBackend({ mode: 'claim-account', name, deviceId });
    if (!claim.ok) {
        return { ok: false, allowed: false, message: claim.message || 'Device authorization failed.' };
    }

    // Check existing auth session
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        if (sessionData && sessionData.session) {
            return { ok: true, allowed: true };
        }
    } catch (e) {
        console.warn('Session check error:', e);
    }

    // Silent password authentication via account claim credentials
    try {
        if (claim.email && claim.password) {
            const { error: signInError } = await supabaseClient.auth.signInWithPassword({
                email: claim.email,
                password: claim.password
            });
            if (signInError) {
                console.warn('Supabase Auth signIn warning (falling back to claim approval):', signInError.message);
            }
        }
        return { ok: true, allowed: true };
    } catch (err) {
        return { ok: true, allowed: true };
    }
}

function verifyDeviceOwnership(name) {
    return authenticateStaffWithPasskey(name);
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
    return safeStorage.getItem(STORAGE_KEYS.deviceLock);
}

function setLocalDeviceLockHint(name) {
    safeStorage.setItem(STORAGE_KEYS.deviceLock, name);
}

function clearLocalDeviceLockHint() {
    safeStorage.removeItem(STORAGE_KEYS.deviceLock);
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
    
    const retryCount = parseInt(safeStorage.getItem('sync_retry_count') || '0', 10);
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), 60000);
    safeStorage.setItem('sync_retry_count', retryCount + 1);
    
    syncRetryTimer = setTimeout(() => {
        flushPendingQueue();
    }, delay);
}

function resetSyncRetryCount() {
    safeStorage.removeItem('sync_retry_count');
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
        safeStorage.removeItem(STORAGE_KEYS.pendingAction);
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
    safeStorage.setItem(STORAGE_KEYS.lastSynced, 'Queued offline');
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

let currentStaffTodayMode = 'office'; // 'home' | 'office' | 'leave'

function isCurrentStaffWfhToday() {
    return currentStaffTodayMode === 'home';
}

/* ---------- Live Running Digital Clock ---------- */

function initLiveClock() {
    const clockEl = document.getElementById('live-clock');
    if (!clockEl) return;

    const update = () => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        const dayName = now.toLocaleDateString([], { weekday: 'short' });
        const monthName = now.toLocaleDateString([], { month: 'short' });
        const dayNum = now.getDate();
        clockEl.textContent = `${timeStr} • ${dayName}, ${monthName} ${dayNum}`;
    };
    update();
    setInterval(update, 1000);
}

/* ---------- Tenant Config & Remote Sign-Out State ---------- */

let tenantConfigCache = null;

async function getTenantAppConfig() {
    if (tenantConfigCache) return tenantConfigCache;
    try {
        const res = await callBackend({ mode: 'get-config' });
        if (res && res.ok && res.config) {
            tenantConfigCache = res.config;
            return tenantConfigCache;
        }
    } catch (e) {
        console.warn('Could not fetch app config:', e);
    }
    return {};
}

function hasStaffSignedInToday(name) {
    if (!name) return false;
    const todayKey = getTodayKey();
    const recentLogs = readStoredJson(STORAGE_KEYS.recentLog, []);
    return recentLogs.some((entry) => {
        if (!entry || entry.name !== name || entry.status === 'failed') return false;
        const matchesDate = (entry.timestamp && entry.timestamp.startsWith(todayKey)) || (entry.date && entry.date === todayKey);
        return matchesDate && entry.action === 'IN';
    });
}

function isPostClosingRemoteSignoutActive(name) {
    if (!name) return false;
    // Must have signed in today
    if (!hasStaffSignedInToday(name)) return false;

    // Check tenant config
    const cfg = tenantConfigCache || {};
    const allowRemote = cfg.ALLOW_REMOTE_SIGNOUT_POST_CLOSING !== undefined ? cfg.ALLOW_REMOTE_SIGNOUT_POST_CLOSING : true;
    if (allowRemote === false || allowRemote === 'false') return false;

    // Check time: closing time default 17:00 (1020 mins)
    const closingMinutes = cfg.WORKDAY_END_MINUTES !== undefined ? Number(cfg.WORKDAY_END_MINUTES) : (cfg.CLOSING_TIME_MINUTES !== undefined ? Number(cfg.CLOSING_TIME_MINUTES) : 1020);
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return currentMinutes >= closingMinutes;
}

/* ---------- Action Hero Button State Machine ---------- */

function updateActionHeroState() {
    const nameSelect = document.getElementById('staff-name');
    const name = nameSelect ? nameSelect.value : '';
    const inBtn = document.getElementById('in-btn');
    const inBtnText = document.getElementById('in-btn-text');
    const outBtn = document.getElementById('out-btn');

    if (!inBtn) return;

    const isWfh = isCurrentStaffWfhToday();
    const isLeave = (currentStaffTodayMode === 'leave');
    const canUse = Boolean(name) && (Boolean(coords) || isWfh);

    const setIcon = (iconName) => {
        const currentIcon = document.getElementById('in-btn-icon');
        if (currentIcon) {
            currentIcon.outerHTML = `<i id="in-btn-icon" data-lucide="${iconName}" class="hero-btn-icon" size="36" aria-hidden="true"></i>`;
        }
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    };

    const setClasses = (activeClass) => {
        inBtn.classList.remove('state-in', 'state-out', 'state-done', 'state-leave');
        inBtn.classList.add(activeClass);
    };

    // Case 1: No staff selected
    if (!name) {
        setClasses('state-in');
        if (inBtnText) inBtnText.textContent = t('signIn', 'SIGN IN');
        inBtn.disabled = true;
        inBtn.dataset.heroMode = 'IN';
        inBtn.setAttribute('aria-label', 'Sign in (select name to start)');
        setIcon('log-in');
        if (outBtn) outBtn.disabled = true;
        return;
    }

    // Case 2: On Leave today
    if (isLeave) {
        setClasses('state-leave');
        if (inBtnText) inBtnText.textContent = t('onLeave', 'ON LEAVE');
        inBtn.disabled = true;
        inBtn.dataset.heroMode = 'LEAVE';
        inBtn.setAttribute('aria-label', 'On Leave today');
        setIcon('palm-tree');
        if (outBtn) outBtn.disabled = true;
        return;
    }

    // Determine today's logs for this specific staff member
    const todayKey = getTodayKey();
    const recentLogs = readStoredJson(STORAGE_KEYS.recentLog, []);

    // Filter user's logs for today (including pending offline records)
    const userTodayLogs = recentLogs.filter((entry) => {
        if (!entry || entry.name !== name || entry.status === 'failed') return false;
        if (entry.timestamp && entry.timestamp.startsWith(todayKey)) return true;
        if (entry.date && entry.date === todayKey) return true;
        return false;
    });

    let currentHeroAction = 'IN';

    if (userTodayLogs.length > 0) {
        userTodayLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const latest = userTodayLogs[0];
        if (latest.action === 'IN') {
            currentHeroAction = 'OUT';
        } else if (latest.action === 'OUT') {
            currentHeroAction = 'DONE';
        }
    }

    // Case 3: Completed attendance for today
    if (currentHeroAction === 'DONE') {
        setClasses('state-done');
        if (inBtnText) inBtnText.textContent = t('completed', 'COMPLETED');
        inBtn.disabled = true;
        inBtn.dataset.heroMode = 'DONE';
        inBtn.setAttribute('aria-label', 'Attendance completed for today');
        setIcon('check-circle-2');
        if (outBtn) outBtn.disabled = true;
        return;
    }

    // Case 4: Signed in, awaiting sign-out
    if (currentHeroAction === 'OUT') {
        setClasses('state-out');
        const isRemoteSignoutEligible = isPostClosingRemoteSignoutActive(name);
        const canSignOut = Boolean(coords) || isWfh || isRemoteSignoutEligible;
        if (inBtnText) {
            inBtnText.textContent = (isRemoteSignoutEligible && !coords && !isWfh) ? t('signOutRemote', 'SIGN OUT (REMOTE)') : t('signOut', 'SIGN OUT');
        }
        inBtn.disabled = !canSignOut;
        inBtn.dataset.heroMode = 'OUT';
        inBtn.setAttribute('aria-label', isRemoteSignoutEligible && !coords ? 'Sign out remotely (post-closing)' : 'Sign out');
        setIcon('log-out');
        if (outBtn) outBtn.disabled = !canSignOut;

        const locStatus = document.getElementById('loc-status');
        if (locStatus && isRemoteSignoutEligible && !coords && !isWfh) {
            locStatus.innerText = t('remoteActive', '🏠 Remote Sign-Out Active');
            locStatus.className = 'status ready';
        }
        return;
    }

    // Case 5: Not signed in yet today
    setClasses('state-in');
    if (inBtnText) inBtnText.textContent = t('signIn', 'SIGN IN');
    inBtn.disabled = !canUse;
    inBtn.dataset.heroMode = 'IN';
    inBtn.setAttribute('aria-label', 'Sign in');
    setIcon('log-in');
    if (outBtn) outBtn.disabled = !canUse;

    // Biometric 1-tap quick trigger synchronization
    const bioTriggerBtn = document.getElementById('biometric-auth-trigger');
    if (bioTriggerBtn) {
        const showBioTrigger = Boolean(name) && isBiometricsEnrolled(name) && (currentHeroAction === 'IN' || currentHeroAction === 'OUT');
        bioTriggerBtn.style.display = showBioTrigger ? 'inline-flex' : 'none';
        if (showBioTrigger) {
            bioTriggerBtn.disabled = !canUse;
            const bioSpan = bioTriggerBtn.querySelector('span');
            if (bioSpan) {
                bioSpan.textContent = currentHeroAction === 'OUT' ? 'Confirm Sign Out with Biometrics' : 'Confirm Sign In with Biometrics';
            }
        }
    }
}

function updateSignInButtonsState() {
    updateActionHeroState();
}

/* ---------- Staff Identity & Device Linking ---------- */

let currentStaffList = [];
let staffDirectoryData = [];
let highlightedOptionIndex = -1;

function initStaffIdentityView() {
    const linkedCard = document.getElementById('linked-identity-card');
    const unlinkedBox = document.getElementById('unlinked-entry-box');
    const nameDisplay = document.getElementById('linked-name-display');
    const deptDisplay = document.getElementById('linked-dept-display');
    const staffSelect = document.getElementById('staff-name');
    const searchInput = document.getElementById('staff-search-input');
    const bioTriggerBtn = document.getElementById('biometric-auth-trigger');

    if (!linkedCard || !unlinkedBox) return;

    const savedName = safeStorage.getItem('saved_name') || getLocalDeviceLockHint() || '';
    const savedDept = safeStorage.getItem('saved_dept') || 'Staff Member';

    if (savedName) {
        // Recognized device: Show personal linked card
        linkedCard.style.display = 'flex';
        unlinkedBox.style.display = 'none';
        if (nameDisplay) {
            nameDisplay.textContent = savedName;
            const staffObj = staffDirectoryData.find(s => s.name && s.name.toLowerCase() === savedName.toLowerCase());
            if (staffObj?.is_team_lead) {
                const starSpan = document.createElement('span');
                starSpan.textContent = ' ★';
                starSpan.className = 'staff-lead-star';
                starSpan.title = 'Team Lead';
                starSpan.style.color = '#f59e0b';
                starSpan.style.fontSize = '0.95rem';
                nameDisplay.appendChild(starSpan);
            }
        }
        if (deptDisplay) deptDisplay.textContent = savedDept;

        const bioBadge = document.getElementById('linked-bio-badge');
        if (bioBadge) {
            bioBadge.style.display = isBiometricsEnrolled(savedName) ? 'inline-block' : 'none';
        }

        if (staffSelect) {
            staffSelect.innerHTML = `<option value="${escapeHtml(savedName)}" selected>${escapeHtml(savedName)}</option>`;
            staffSelect.value = savedName;
        }

        if (searchInput) searchInput.value = savedName;

        const switchIdentityBtn = document.getElementById('switch-identity-btn');
        if (switchIdentityBtn && !switchIdentityBtn.dataset.bound) {
            switchIdentityBtn.dataset.bound = 'true';
            switchIdentityBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openDeviceTransferModal();
            });
        }

        updateSignInButtonsState();
        updateScheduleBanner(savedName);
    } else {
        // Unlinked device: Show type-to-search dropdown box
        linkedCard.style.display = 'none';
        unlinkedBox.style.display = 'block';
        const bioBadge = document.getElementById('linked-bio-badge');
        if (bioBadge) bioBadge.style.display = 'none';
        if (bioTriggerBtn) bioTriggerBtn.style.display = 'none';

        if (staffSelect && !staffSelect.value) {
            staffSelect.innerHTML = '<option value="">Select your name...</option>' + 
                currentStaffList.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
            staffSelect.value = '';
        }
        if (searchInput) searchInput.value = '';

        updateSignInButtonsState();
        updateScheduleBanner(null);
        initSearchableStaffDropdown();
    }

    // Attach Biometric Trigger button handler
    if (bioTriggerBtn && !bioTriggerBtn.dataset.bound) {
        bioTriggerBtn.dataset.bound = 'true';
        bioTriggerBtn.addEventListener('click', () => {
            const inBtn = document.getElementById('in-btn');
            if (inBtn && !inBtn.disabled) {
                inBtn.click();
            } else {
                showToast('Attendance button is not active yet. Please verify GPS location.', 'info');
            }
        });
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function initSearchableStaffDropdown() {
    const wrapper = document.getElementById('staff-search-wrapper');
    const input = document.getElementById('staff-search-input');
    const optionsList = document.getElementById('staff-options-list');
    const clearBtn = document.getElementById('staff-search-clear');
    const toggleBtn = document.getElementById('staff-search-toggle');
    const select = document.getElementById('staff-name');

    if (!wrapper || !input || !optionsList || !select) return;

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

            const staffObj = staffDirectoryData.find(s => s.name && s.name.toLowerCase() === name.toLowerCase());
            const deptText = staffObj?.dept || '';

            const leftBox = document.createElement('div');
            leftBox.style.display = 'flex';
            leftBox.style.alignItems = 'center';
            leftBox.style.gap = '8px';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            if (staffObj?.is_team_lead) {
                const starSpan = document.createElement('span');
                starSpan.textContent = ' ★';
                starSpan.className = 'staff-lead-star';
                starSpan.title = 'Team Lead';
                starSpan.style.color = '#f59e0b';
                starSpan.style.fontSize = '0.90rem';
                nameSpan.appendChild(starSpan);
            }
            leftBox.appendChild(nameSpan);

            li.appendChild(leftBox);

            const rightBox = document.createElement('div');
            rightBox.style.display = 'flex';
            rightBox.style.alignItems = 'center';
            rightBox.style.gap = '6px';

            if (deptText && deptText !== 'General') {
                const deptSpan = document.createElement('span');
                deptSpan.textContent = deptText;
                deptSpan.style.fontSize = '0.72rem';
                deptSpan.style.opacity = '0.7';
                deptSpan.style.fontWeight = 'normal';
                rightBox.appendChild(deptSpan);
            }

            if (select.value === name) {
                const checkSpan = document.createElement('span');
                checkSpan.textContent = '✓';
                checkSpan.style.fontSize = '0.85rem';
                rightBox.appendChild(checkSpan);
            }

            li.appendChild(rightBox);

            li.addEventListener('click', (e) => {
                e.stopPropagation();
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

    async function selectStaffMember(name) {
        if (!name) return;
        const staffObj = staffDirectoryData.find(s => s.name && s.name.toLowerCase() === name.toLowerCase());
        const dept = staffObj?.dept || 'Staff Member';
        const currentLock = getLocalDeviceLockHint();

        // If device is already linked to this exact staff member, confirm selection
        if (currentLock && currentLock.toLowerCase() === name.toLowerCase()) {
            select.value = name;
            input.value = name;
            if (clearBtn) clearBtn.style.display = 'block';
            safeStorage.setItem('saved_name', name);
            safeStorage.setItem('saved_dept', dept);
            closeDropdown();
            initStaffIdentityView();
            updateSignInButtonsState();
            return;
        }

        // Workflow Step 3: MUST verify biometrics / device PIN BEFORE linking name to device
        const bioAvail = await isBiometricsAvailable().catch(() => false);
        const isEnrolled = isBiometricsEnrolled(name);

        if (isEnrolled) {
            showToast(`Verifying Biometrics / PIN for ${name}...`, 'info');
            const verifyRes = await verifyBiometrics(name);
            if (verifyRes && verifyRes.success) {
                select.value = name;
                input.value = name;
                if (clearBtn) clearBtn.style.display = 'block';
                safeStorage.setItem('saved_name', name);
                safeStorage.setItem('saved_dept', dept);
                setLocalDeviceLockHint(name);
                closeDropdown();
                initStaffIdentityView();
                updateSignInButtonsState();
                showToast(`Biometrics verified! Device linked to ${name}.`, 'success');
            } else {
                clearSelection();
                showToast(`Biometric verification failed. Device not linked.`, 'error');
            }
            return;
        }

        if (bioAvail) {
            showBiometricEnrollModal(
                staffObj?.id || name, 
                name, 
                () => {
                    select.value = name;
                    input.value = name;
                    if (clearBtn) clearBtn.style.display = 'block';
                    safeStorage.setItem('saved_name', name);
                    safeStorage.setItem('saved_dept', dept);
                    setLocalDeviceLockHint(name);
                    closeDropdown();
                    initStaffIdentityView();
                    updateSignInButtonsState();
                    showToast(`Device linked to ${name} with biometric protection!`, 'success');
                },
                () => {
                    clearSelection();
                    showToast(`Biometric / Device PIN verification required to link phone to ${name}.`, 'error');
                }
            );
            return;
        }

        // Fallback for browsers/devices without WebAuthn
        const confirmBind = window.confirm(`Verify device linking for ${name} (${dept})?\n\nThis will pair this phone to your profile for daily 1-tap sign-ins.`);
        if (confirmBind) {
            select.value = name;
            input.value = name;
            if (clearBtn) clearBtn.style.display = 'block';
            safeStorage.setItem('saved_name', name);
            safeStorage.setItem('saved_dept', dept);
            setLocalDeviceLockHint(name);
            closeDropdown();
            initStaffIdentityView();
            updateSignInButtonsState();
            showToast(`Device linked to ${name} (${dept})`, 'success');
        } else {
            clearSelection();
            showToast(`Device linking cancelled.`, 'info');
        }
    }

    function clearSelection() {
        select.value = '';
        input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        safeStorage.removeItem('saved_name');
        safeStorage.removeItem('saved_dept');
        clearLocalDeviceLockHint();
        select.dispatchEvent(new Event('change', { bubbles: true }));
        updateSignInButtonsState();
        openDropdown();
        input.focus();
    }

    if (!input.dataset.bound) {
        input.dataset.bound = 'true';

        input.addEventListener('focus', () => openDropdown());
        input.addEventListener('click', () => openDropdown());

        input.addEventListener('input', (e) => {
            if (!wrapper.classList.contains('open')) openDropdown();
            const query = e.target.value;
            if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

            if (!query) {
                select.value = '';
                safeStorage.removeItem('saved_name');
                safeStorage.removeItem('saved_dept');
                clearLocalDeviceLockHint();
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
                } else if (items.length === 1) {
                    const val = items[0].getAttribute('data-value');
                    if (val) selectStaffMember(val);
                }
            } else if (e.key === 'Escape') {
                closeDropdown();
            }
        });
    }

    if (clearBtn && !clearBtn.dataset.bound) {
        clearBtn.dataset.bound = 'true';
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
        });
    }

    if (toggleBtn && !toggleBtn.dataset.bound) {
        toggleBtn.dataset.bound = 'true';
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

    if (!document.body.dataset.staffDropdownBound) {
        document.body.dataset.staffDropdownBound = 'true';
        document.addEventListener('click', (e) => {
            const w = document.getElementById('staff-search-wrapper');
            const inp = document.getElementById('staff-search-input');
            const clr = document.getElementById('staff-search-clear');
            const sel = document.getElementById('staff-name');
            if (!w || !inp || !sel) return;

            if (!w.contains(e.target)) {
                w.classList.remove('open');
                const optList = document.getElementById('staff-options-list');
                if (optList) optList.style.display = 'none';
                inp.setAttribute('aria-expanded', 'false');

                if (sel.value) {
                    inp.value = sel.value;
                    if (clr) clr.style.display = 'block';
                } else if (!inp.value) {
                    if (clr) clr.style.display = 'none';
                }
            }
        });
    }

    const currentSaved = select.value || safeStorage.getItem('saved_name') || '';
    if (currentSaved) {
        select.value = currentSaved;
        input.value = currentSaved;
        if (clearBtn) clearBtn.style.display = 'block';
    }
}

function populateStaffDropdown(names) {
    const staffSelect = document.getElementById('staff-name');
    if (!staffSelect || !Array.isArray(names)) return;

    currentStaffList = names.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const savedName = safeStorage.getItem('saved_name') || getLocalDeviceLockHint() || '';
    staffSelect.innerHTML = '<option value="">Select your name...</option>' +
        currentStaffList.map(name => `<option value="${escapeHtml(name)}"${name === savedName ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');

    initSearchableStaffDropdown();
}

function showBiometricEnrollModal(staffId, staffName, onEnrollSuccess, onEnrollCancel) {
    const modal = document.getElementById('biometric-enroll-modal');
    const confirmBtn = document.getElementById('enable-bio-confirm-btn');
    const skipBtn = document.getElementById('skip-bio-btn');
    if (!modal) return;

    modal.style.display = 'flex';

    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = 'Verifying Fingerprint / Face ID / Device PIN...';
            try {
                const tenant = await getActiveTenant();
                await enrollBiometrics(staffId, staffName, tenant ? tenant.name : 'Attendance Cloud');
                modal.style.display = 'none';
                const bioBadge = document.getElementById('linked-bio-badge');
                if (bioBadge) bioBadge.style.display = 'inline-block';
                updateSignInButtonsState();
                showToast('Biometric / Device PIN verification enabled!', 'success');
                if (typeof onEnrollSuccess === 'function') onEnrollSuccess();
            } catch (err) {
                console.warn('Biometric enrollment error:', err);
                modal.style.display = 'none';
                showToast(err.message || 'Biometric / PIN enrollment cancelled.', 'error');
                if (typeof onEnrollCancel === 'function') onEnrollCancel();
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i data-lucide="fingerprint" size="18"></i> Enable Biometrics / Device PIN';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
        };
    }

    if (skipBtn) {
        skipBtn.onclick = () => {
            modal.style.display = 'none';
            showToast('Biometric verification cancelled. Device not linked.', 'info');
            if (typeof onEnrollCancel === 'function') onEnrollCancel();
        };
    }
}

async function loadStaffDropdown() {
    // 1. Check local cache first for instantaneous rendering
    const cachedStaff = readStoredJson('attendance_staff_cache_v2', []);
    if (Array.isArray(cachedStaff) && cachedStaff.length) {
        staffDirectoryData = cachedStaff;
        const names = cachedStaff.map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
        if (names.length) populateStaffDropdown(names);
    }

    try {
        const res = await callBackend({ mode: 'list-staff' });
        if (res && res.ok && Array.isArray(res.staff) && res.staff.length) {
            staffDirectoryData = res.staff;
            writeStoredJson('attendance_staff_cache_v2', staffDirectoryData);
            const names = res.staff.map(s => s.name).filter(Boolean);
            populateStaffDropdown(names);
        }
    } catch (err) {
        console.warn('Could not refresh staff list from server:', err.message);
    }

    // If device is already linked, verify / refresh this member's metadata and check for remote admin resets
    const savedName = safeStorage.getItem('saved_name') || getLocalDeviceLockHint();
    if (savedName) {
        try {
            const res = await callBackend({ mode: 'verify-staff-member', name: savedName });
            if (res && res.ok && res.name) {
                // Check if administrator has remotely reset or unlinked this device
                if (res.was_unlinked_by_admin && getLocalDeviceLockHint()) {
                    safeStorage.removeItem('saved_name');
                    safeStorage.removeItem('saved_dept');
                    clearLocalDeviceLockHint();
                    clearBiometrics(savedName);
                    initStaffIdentityView();
                    showToast('Your device binding was reset by the administrator. Please select your name.', 'info');
                    return;
                }
                safeStorage.setItem('saved_dept', res.dept || 'Staff Member');
                const deptDisplay = document.getElementById('linked-dept-display');
                if (deptDisplay) deptDisplay.textContent = res.dept || 'Staff Member';
            }
        } catch (e) {
            console.warn('Could not refresh staff identity metadata:', e.message);
        }
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

    const isWfh = isCurrentStaffWfhToday();
    const isRemoteSignout = (action === 'OUT' && isPostClosingRemoteSignoutActive(name));

    if (navigator.geolocation) {
        setMessage('Checking your current location...', 'msg-welcome');
        await getFreshCoordsForSubmit();
    }

    if (!coords && !isWfh && !isRemoteSignout) {
        requestLocation();
        updateSignInButtonsState();
        showToast('Could not get your current location. Please try again.', 'error');
        return;
    }

    const submitLat = coords ? coords.lat : 0;
    const submitLon = coords ? coords.lon : 0;

    if (!navigator.onLine) {
        if (!isWfh && !isRemoteSignout && (!coords || !coords.lat || !coords.lon)) {
            showToast('Location required. Cannot sign in without GPS.', 'error');
            updateSignInButtonsState();
            return;
        }
        queuePendingSubmission(name, action, submitLat, submitLon);
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

    // WebAuthn Biometric Verification Gate
    if (isBiometricsEnrolled(name)) {
        setMessage('Waiting for Face ID / Fingerprint...', 'msg-welcome');
        const bioResult = await verifyBiometrics(name);
        if (!bioResult.success) {
            setMessage('Biometric verification cancelled or failed.', 'msg-late');
            showToast(bioResult.message || 'Biometric authentication cancelled.', 'error');
            updateSignInButtonsState();
            return;
        }
        setMessage('Biometrics verified! Syncing...', 'msg-welcome');
    }

    document.getElementById('in-btn').disabled = true;
    document.getElementById('out-btn').disabled = true;
    setMessage('Syncing...', 'msg-welcome');
    syncInProgress = true;
    activeSubmission = { name, action, lat: submitLat, lon: submitLon };

    try {
        const data = await callBackend({
            mode: 'attendance',
            name,
            action,
            lat: submitLat,
            lon: submitLon,
            deviceId,
            isRemoteSignOut: Boolean(isRemoteSignout)
        });
        await handleAttendanceResponse(data);
    } catch (error) {
        syncInProgress = false;
        activeSubmission = null;
        setMessage('Sync failed. Saving offline and retrying...', 'msg-late');
        queuePendingSubmission(name, action, submitLat, submitLon);
        scheduleSyncRetry(10000);
    }
}

function triggerOfflineSyncNotification(name, action) {
    const actionText = action === 'IN' ? 'Sign-In' : 'Sign-Out';
    const title = 'Offline Attendance Synced';
    const body = `Your ${actionText} record for ${name} has been updated live!`;

    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'OFFLINE_SYNC_SUCCESS',
                name,
                action
            }));
        } catch (e) {
            console.warn('Could not post offline sync message to WebView:', e);
        }
    }

    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(title, { body });
        } catch (e) {
            console.warn('Web notification error:', e);
        }
    }

    showToast(`Offline ${actionText} synced live for ${name}!`, 'success', 5000);
}

async function handleAttendanceResponse(data) {
    if (!data) {
        setMessage('Unexpected response from server (empty response).', 'msg-late');
        syncInProgress = false;
        activeSubmission = null;
        updateSignInButtonsState();
        return;
    }
    if (!data.raw) {
        setMessage(data.message || 'Unexpected response from server (missing raw data).', 'msg-late');
        syncInProgress = false;
        activeSubmission = null;
        updateSignInButtonsState();
        return;
    }

    const { status, message: text, distance: distanceStr } = data.raw;
    const isSuccess = ['WELCOME', 'NORMAL', 'LATE'].includes(status);

    if (isSuccess) {
        setMessage(text || 'Action recorded.', (status === 'WELCOME' || status === 'NORMAL') ? 'msg-welcome' : 'msg-late');
        playWindowsSound(status === 'WELCOME' || status === 'NORMAL');
    } else {
        setMessage(text || status || 'Action denied.', 'msg-late');
        playWindowsSound(false);
    }

    let finalDistance = distanceStr;
    if (!isSuccess && text && !isNaN(parseFloat(text))) {
        finalDistance = text;
    }
    updateDistanceLabel(finalDistance);

    if (activeSubmission && isSuccess) {
        rememberLastAction(activeSubmission.action, activeSubmission.name);
        clearPendingAction(activeSubmission.action, activeSubmission.name);

        if (activeSubmission.pendingId) {
            triggerOfflineSyncNotification(activeSubmission.name, activeSubmission.action);
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

        safeStorage.setItem(STORAGE_KEYS.lastSynced, formatDateDisplay(new Date().toISOString()));
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
    } else if (activeSubmission && activeSubmission.pendingId && !isSuccess) {
        clearPendingAction(activeSubmission.action, activeSubmission.name);
        updateRecentEntryStatus(activeSubmission.pendingId, 'failed');
        removeQueuedSubmission(activeSubmission.pendingId);
        activeSubmission = null;
    } else if (activeSubmission && !isSuccess) {
        activeSubmission = null;
    }

    syncInProgress = false;
    updateSignInButtonsState();
    refreshRecentLogsFromDb();
    flushPendingQueue();
}

/* ---------- Geolocation ---------- */

let locationWatchId = null;
let locationWatchErrorShown = false;
let coordsTimestamp = 0;

function requestLocation() {
    if (!navigator.geolocation) {
        const locStatus = document.getElementById('loc-status');
        if (locStatus) locStatus.innerText = 'GPS unsupported';
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
            const locStatus = document.getElementById('loc-status');
            const distLabel = document.getElementById('distance-label');
            const currentSelectedStaff = document.getElementById('staff-name')?.value || safeStorage.getItem('saved_name') || getLocalDeviceLockHint();
            if (!currentSelectedStaff) {
                if (locStatus) {
                    locStatus.innerText = t('gpsReady', '📍 GPS Ready • Select Name');
                    locStatus.className = 'status ready';
                }
                if (distLabel) distLabel.textContent = '';
            } else if (isCurrentStaffWfhToday()) {
                if (locStatus) {
                    locStatus.innerText = t('homeMode', '🏠 Virtual Mode');
                    locStatus.className = 'status ready';
                }
                if (distLabel) distLabel.textContent = '';
            } else {
                if (locStatus) {
                    locStatus.innerText = t('officeMode', '📍 Office');
                    locStatus.className = 'status ready';
                }
            }
            locationWatchErrorShown = false;
            updateActionHeroState();
            flushPendingQueue();
        },
        (err) => {
            let userMsg = 'Location access is required to sign in.';
            if (err.code === 1) {
                userMsg = 'Location access was denied. Please allow location, then refresh the page.';
            } else if (err.code === 2) {
                userMsg = 'Location service is disabled on your device. Please allow location, then refresh the page.';
            }
            const locStatus = document.getElementById('loc-status');
            const distLabel = document.getElementById('distance-label');
            if (isCurrentStaffWfhToday()) {
                if (locStatus) {
                    locStatus.innerText = t('homeMode', '🏠 Virtual Mode');
                    locStatus.className = 'status ready';
                }
                if (distLabel) distLabel.textContent = '';
            } else {
                if (locStatus) {
                    locStatus.innerText = t('officeRequired', '📍 Office (Required)');
                    locStatus.className = 'status waiting';
                }
            }
            updateActionHeroState();
            if (!locationWatchErrorShown && !isCurrentStaffWfhToday()) {
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

function initRefreshButton() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (!refreshBtn) return;
    refreshBtn.addEventListener('click', async () => {
        showToast('Refreshing...', 'default', 2000);
        try {
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                    await registration.unregister();
                }
            }
            if ('caches' in window) {
                const keys = await caches.keys();
                for (const key of keys) {
                    await caches.delete(key);
                }
            }
        } catch (e) {
            console.warn('Cache purge error during hard refresh:', e);
        }
        
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.set('reload', Date.now());
        window.location.href = cleanUrl.toString();
    });
}

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initRefreshButton();
    initLiveClock();
    initStaffIdentityView();
    getTenantAppConfig();
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
    deviceId = await generateIdentity();
    window._deviceId = deviceId;

    const staffNameSelect = document.getElementById('staff-name');
    if (staffNameSelect) {
        staffNameSelect.addEventListener('change', () => {
            const name = staffNameSelect.value;
            if (name) {
                safeStorage.setItem('saved_name', name);
                syncScheduleToMobileNative(name);
                refreshRecentLogsFromDb();
                updateScheduleBanner(name);
            } else {
                safeStorage.removeItem('saved_name');
                syncScheduleToMobileNative(null);
                updateScheduleBanner(null);
            }
            updateActionHeroState();
        });
    }

    const inBtn = document.getElementById('in-btn');
    if (inBtn) {
        inBtn.addEventListener('click', () => {
            const mode = inBtn.dataset.heroMode || 'IN';
            if (mode === 'IN' || mode === 'OUT') {
                submit(mode);
            }
        });
    }
    const outBtn = document.getElementById('out-btn');
    if (outBtn) {
        outBtn.addEventListener('click', () => submit('OUT'));
    }

    renderRecentLog();
    updateLastActionLabel();
    updateLastSyncedLabel();
    updateActionHeroState();
    requestLocation();
    flushPendingQueue();
    loadStaffDropdown();

    // Auto-refresh DB logs, banner and sync schedule on load
    const initialName = safeStorage.getItem('saved_name') || getLocalDeviceLockHint();
    if (initialName) {
        setTimeout(() => {
            syncScheduleToMobileNative(initialName);
            refreshRecentLogsFromDb();
            updateScheduleBanner(initialName);
        }, 800);
    }

    const installBtn = document.getElementById('install-btn');

    if (installBtn) {
        installBtn.addEventListener('click', triggerInstall);
        if (isRunningStandalone()) {
            installBtn.style.display = 'none';
        } else {
            installBtn.style.display = 'inline-flex';
        }
    }

    // Auto-prompt on iOS or web if eligible
    setTimeout(() => {
        attemptAutoInstallPrompt(false);
    }, 1000);
});

/* ---------- PWA Install & Auto-Prompt System ---------- */

let autoPromptAttempted = false;

function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           window.isNativeMobileApp === true ||
           navigator.userAgent.includes('PerimetrrGo') ||
           navigator.userAgent.includes('LifecardApp') ||
           navigator.userAgent.includes('Expo');
}

async function attemptAutoInstallPrompt(isFirstInteraction = false) {
    if (isRunningStandalone()) return;

    const promptEvent = deferredPrompt || window.__deferredPwaPrompt;
    if (promptEvent) {
        if (autoPromptAttempted) return;
        try {
            await promptEvent.prompt();
            autoPromptAttempted = true;
            const choiceResult = await promptEvent.userChoice;
            if (choiceResult && choiceResult.outcome === 'accepted') {
                const btn = document.getElementById('install-btn');
                if (btn) btn.style.display = 'none';
            }
            deferredPrompt = null;
            window.__deferredPwaPrompt = null;
        } catch (e) {
            console.log('Auto-prompt waiting for gesture:', e.message);
        }
    } else {
        const isIos = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
        if (isIos && !sessionStorage.getItem('ios_pwa_hint_shown')) {
            sessionStorage.setItem('ios_pwa_hint_shown', 'true');
            setTimeout(() => {
                showInlineDialog({
                    title: 'Install Attendance App',
                    message: 'Install Attendance for quick 1-tap access and offline sign-in:\n\n1. Tap the Share button at the bottom.\n2. Tap "Add to Home Screen".\n3. Tap "Add" in the top-right.',
                    confirmLabel: 'Got it'
                });
            }, 1200);
        }
    }
}

async function triggerInstall() {
    const promptEvent = deferredPrompt || window.__deferredPwaPrompt;

    if (promptEvent) {
        promptEvent.prompt();
        const choiceResult = await promptEvent.userChoice;
        if (choiceResult && choiceResult.outcome === 'accepted') {
            const btn = document.getElementById('install-btn');
            if (btn) btn.style.display = 'none';
        }
        deferredPrompt = null;
        window.__deferredPwaPrompt = null;
        return;
    }

    if (isRunningStandalone()) {
        const btn = document.getElementById('install-btn');
        if (btn) btn.style.display = 'none';
        showToast('App is already installed.', 'success', 3000);
        return;
    }

    const isIos = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
    if (isIos) {
        showInlineDialog({
            title: 'Install Web App',
            message: 'To install on iPhone/iPad:\n\n1. Tap the Share button at the bottom of your screen.\n2. Scroll and select "Add to Home Screen".\n3. Tap "Add" at the top-right.',
            confirmLabel: 'Got it'
        });
    } else {
        showToast('To install: open browser menu and select "Install app" or "Add to Home screen".', 'default', 6000);
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.__deferredPwaPrompt = e;
    const installBtn = document.getElementById('install-btn');
    if (installBtn && !isRunningStandalone()) {
        installBtn.style.display = 'inline-flex';
    }
    // Auto-trigger prompt as soon as the browser prepares it
    setTimeout(() => {
        attemptAutoInstallPrompt(false);
    }, 600);
});

// Trigger on first screen interaction if browser blocked auto-prompt without gesture
const onFirstScreenInteraction = () => {
    window.removeEventListener('pointerdown', onFirstScreenInteraction);
    window.removeEventListener('click', onFirstScreenInteraction);
    window.removeEventListener('touchstart', onFirstScreenInteraction);
    attemptAutoInstallPrompt(true);
};

window.addEventListener('pointerdown', onFirstScreenInteraction, { once: true });
window.addEventListener('click', onFirstScreenInteraction, { once: true });
window.addEventListener('touchstart', onFirstScreenInteraction, { once: true });

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__deferredPwaPrompt = null;
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
    const faqFooterLink = document.getElementById('faq-footer-link');
    const faqModal = document.getElementById('faq-modal');
    const faqCloseBtn = document.getElementById('faq-close-btn');
    const faqSearch = document.getElementById('faq-search');
    const faqContent = document.getElementById('faq-content');
    const categoryBtns = document.querySelectorAll('.faq-category-btn');
    const questionBtns = document.querySelectorAll('.faq-question');
    
    if (!faqModal) return;
    
    let previousActiveElement = null;
    let isSearching = false;
    
    if (faqBtn && !faqBtn.dataset.bound) {
        faqBtn.dataset.bound = 'true';
        faqBtn.addEventListener('click', () => {
            previousActiveElement = document.activeElement;
            openFaqModal();
        });
    }

    if (faqFooterLink && !faqFooterLink.dataset.bound) {
        faqFooterLink.dataset.bound = 'true';
        faqFooterLink.addEventListener('click', () => {
            previousActiveElement = document.activeElement;
            openFaqModal();
        });
    }
    
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
        
        // Reset to first category cleanly
        categoryBtns.forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        });
        const firstCategoryBtn = categoryBtns[0];
        if (firstCategoryBtn) {
            firstCategoryBtn.classList.add('active');
            firstCategoryBtn.setAttribute('aria-pressed', 'true');
            const category = firstCategoryBtn.closest('.faq-category')?.dataset.category || 'location';
            filterByCategory(category);
        }
        if (faqSearch) {
            faqSearch.value = '';
            isSearching = false;
        }

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

function initPrivacyModal() {
    const privacyLink = document.getElementById('privacy-policy-link');
    const privacyModal = document.getElementById('privacy-modal');
    const privacyClose = document.getElementById('privacy-modal-close');

    if (!privacyLink || !privacyModal) return;

    function openPrivacyModal() {
        const tenantNameEl = document.getElementById('privacy-policy-tenant-name');
        if (tenantNameEl) {
            getActiveTenant().then(t => {
                if (t && t.name) tenantNameEl.textContent = `${t.name} (Perimetrr Workspace)`;
            }).catch(() => {});
        }
        privacyModal.classList.add('active');
        privacyModal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
        if (privacyClose) privacyClose.focus();
    }

    function closePrivacyModal() {
        privacyModal.classList.remove('active');
        privacyModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        privacyLink.focus();
    }

    privacyLink.addEventListener('click', openPrivacyModal);
    if (privacyClose) privacyClose.addEventListener('click', closePrivacyModal);

    privacyModal.addEventListener('click', (e) => {
        if (e.target === privacyModal) closePrivacyModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && privacyModal.classList.contains('active')) {
            closePrivacyModal();
        }
    });
}

function openWorkspaceConnectModal() {
    const overlay = document.getElementById('workspace-connect-overlay');
    const input = document.getElementById('workspace-code-input');
    const err = document.getElementById('workspace-connect-error');
    if (overlay) {
        overlay.style.display = 'flex';
        overlay.classList.add('active');
        if (err) err.style.display = 'none';
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 150);
        }
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }
}

function closeWorkspaceConnectModal() {
    const overlay = document.getElementById('workspace-connect-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('active');
    }
    if (typeof stopWorkspaceQrScanner === 'function') stopWorkspaceQrScanner();
}

window.openWorkspaceConnectModal = openWorkspaceConnectModal;
window.closeWorkspaceConnectModal = closeWorkspaceConnectModal;

let activeWorkspaceQrStream = null;
let activeWorkspaceQrInterval = null;

function stopWorkspaceQrScanner() {
    if (activeWorkspaceQrInterval) {
        clearInterval(activeWorkspaceQrInterval);
        activeWorkspaceQrInterval = null;
    }
    if (activeWorkspaceQrStream) {
        activeWorkspaceQrStream.getTracks().forEach(track => {
            try { track.stop(); } catch (e) {}
        });
        activeWorkspaceQrStream = null;
    }
    const scannerBox = document.getElementById('workspace-qr-scanner-box');
    if (scannerBox) scannerBox.classList.remove('active');
    const scanBtn = document.getElementById('scan-workspace-qr-btn');
    if (scanBtn) scanBtn.style.display = 'flex';
}

function initWorkspaceConnect() {
    const connectBtn = document.getElementById('connect-workspace-btn');
    const input = document.getElementById('workspace-code-input');
    const err = document.getElementById('workspace-connect-error');
    const scanBtn = document.getElementById('scan-workspace-qr-btn');
    const scannerBox = document.getElementById('workspace-qr-scanner-box');
    const videoEl = document.getElementById('workspace-qr-video');
    const closeScanBtn = document.getElementById('close-qr-scanner-btn');
    const guidanceBox = document.getElementById('workspace-qr-guidance');
    const guidanceText = document.getElementById('workspace-qr-guidance-text');
    const retryCamBtn = document.getElementById('retry-qr-camera-btn');

    if (input && !input.dataset.hyphenBound) {
        input.dataset.hyphenBound = 'true';
        input.addEventListener('input', () => {
            let val = input.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
            const clean = val.replace(/-/g, '');
            if (clean.length === 6 && !val.includes('-')) {
                val = `${clean.slice(0, 3)}-${clean.slice(3)}`;
            }
            input.value = val;
        });
    }

    async function handleConnect(overrideCode) {
        const raw = (overrideCode && typeof overrideCode === 'string') ? overrideCode.trim() : (input ? input.value.trim() : '');
        if (!raw) {
            if (err) {
                err.textContent = 'Please enter your 6-character Workspace Code.';
                err.style.display = 'block';
            }
            return;
        }

        if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting...';
        }

        try {
            const rawUpper = raw.toUpperCase();
            const cleanInput = rawUpper.replace(/[^A-Z0-9]/g, '');
            const formattedInput = cleanInput.length === 6 ? `${cleanInput.slice(0, 3)}-${cleanInput.slice(3)}` : rawUpper;

            const registry = await getTenantRegistry();
            const matched = registry.find(t => {
                if (!t) return false;
                const tCode = (t.workspace_code || t.workspaceCode || '').toUpperCase();
                const cleanTCode = tCode.replace(/[^A-Z0-9]/g, '');
                const tSlug = (t.slug || '').toLowerCase();

                return (
                    tCode === rawUpper ||
                    tCode === formattedInput ||
                    (cleanTCode && cleanTCode === cleanInput) ||
                    (tSlug && tSlug === raw.toLowerCase())
                );
            });

            if (!matched) {
                if (err) {
                    err.textContent = 'Invalid Workspace Code. Please verify with your team administrator.';
                    err.style.display = 'block';
                }
                return;
            }

            // If switching to a different workspace, wipe previous employee binding
            const previousSlug = safeStorage.getItem('active_tenant_slug');
            if (previousSlug && previousSlug.toLowerCase() !== matched.slug.toLowerCase()) {
                safeStorage.removeItem('saved_name');
                safeStorage.removeItem('saved_dept');
                safeStorage.removeItem(STORAGE_KEYS.deviceLock);
                safeStorage.removeItem(STORAGE_KEYS.lastAction);
                if (typeof clearLocalDeviceLockHint === 'function') clearLocalDeviceLockHint();
            }

            safeStorage.setItem('active_tenant_slug', matched.slug);
            safeStorage.setItem('attendance_tenant_slug', matched.slug);
            stopWorkspaceQrScanner();
            closeWorkspaceConnectModal();
            showToast(`Connected to ${matched.name}! Switching workspace...`, 'success');

            // Cleanly reload workspace to initialize new office perimeter GPS coordinates, roster, and branding
            setTimeout(() => {
                window.location.reload();
            }, 500);
        } catch (e) {
            if (err) {
                err.textContent = 'Connection error. Please try again.';
                err.style.display = 'block';
            }
        } finally {
            if (connectBtn) {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect Workspace';
            }
        }
    }

    function extractCodeFromQrData(dataString) {
        if (!dataString) return '';
        try {
            if (dataString.includes('http://') || dataString.includes('https://')) {
                const url = new URL(dataString);
                const joinParam = url.searchParams.get('join') || url.searchParams.get('code') || url.searchParams.get('tenant') || url.searchParams.get('company');
                if (joinParam) return joinParam.trim();
            }
        } catch (e) {}
        return dataString.trim();
    }

    async function startWorkspaceQrScanner() {
        if (err) err.style.display = 'none';
        if (guidanceBox) guidanceBox.style.display = 'none';

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (guidanceBox && guidanceText) {
                guidanceText.innerHTML = '<strong>Camera not supported:</strong> Your browser does not support live camera scanning. Please type your 6-character code below.';
                guidanceBox.style.display = 'block';
            }
            if (input) input.focus();
            return;
        }

        try {
            stopWorkspaceQrScanner();
            if (scanBtn) scanBtn.style.display = 'none';
            if (scannerBox) scannerBox.classList.add('active');

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
            activeWorkspaceQrStream = stream;

            if (videoEl) {
                videoEl.srcObject = stream;
                await videoEl.play();
            }

            // QR detection loop using BarcodeDetector API if available
            if ('BarcodeDetector' in window) {
                const detector = new BarcodeDetector({ formats: ['qr_code'] });
                activeWorkspaceQrInterval = setInterval(async () => {
                    if (!videoEl || videoEl.readyState < 2) return;
                    try {
                        const barcodes = await detector.detect(videoEl);
                        if (barcodes && barcodes.length > 0) {
                            const raw = barcodes[0].rawValue;
                            const extracted = extractCodeFromQrData(raw);
                            if (extracted) {
                                stopWorkspaceQrScanner();
                                if (input) input.value = extracted.toUpperCase();
                                showToast('QR code scanned successfully!', 'success');
                                handleConnect(extracted);
                            }
                        }
                    } catch (detErr) {}
                }, 300);
            } else {
                // If BarcodeDetector is not natively present, keep stream visible and guide user
                showToast('Camera active. Align QR code within frame.', 'info');
            }
        } catch (camErr) {
            console.warn('Camera scan access error:', camErr);
            stopWorkspaceQrScanner();

            const isDenied = (camErr.name === 'NotAllowedError' || camErr.name === 'PermissionDeniedError');
            const isNotFound = (camErr.name === 'NotFoundError' || camErr.name === 'DevicesNotFoundError');

            if (guidanceBox && guidanceText) {
                if (isDenied) {
                    guidanceText.innerHTML = '<strong>Camera access blocked:</strong> Tap the <strong>🔒 icon</strong> in your browser address bar to allow camera, or enter your 6-character code below.';
                } else if (isNotFound) {
                    guidanceText.innerHTML = '<strong>No camera detected:</strong> No active camera hardware was found. Enter your 6-character code below.';
                } else {
                    guidanceText.innerHTML = '<strong>Camera unavailable:</strong> Could not start video feed. Enter your 6-character code below.';
                }
                guidanceBox.style.display = 'block';
            }

            if (input) {
                setTimeout(() => input.focus(), 100);
            }
        }
    }

    if (scanBtn && !scanBtn.dataset.bound) {
        scanBtn.dataset.bound = 'true';
        scanBtn.addEventListener('click', startWorkspaceQrScanner);
    }

    if (closeScanBtn && !closeScanBtn.dataset.bound) {
        closeScanBtn.dataset.bound = 'true';
        closeScanBtn.addEventListener('click', stopWorkspaceQrScanner);
    }

    if (retryCamBtn && !retryCamBtn.dataset.bound) {
        retryCamBtn.dataset.bound = 'true';
        retryCamBtn.addEventListener('click', startWorkspaceQrScanner);
    }

    if (connectBtn && !connectBtn.dataset.bound) {
        connectBtn.dataset.bound = 'true';
        connectBtn.addEventListener('click', handleConnect);
    }

    if (input && !input.dataset.bound) {
        input.dataset.bound = 'true';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConnect();
            }
        });
    }

    const switchBtn = document.getElementById('switch-workspace-btn');
    if (switchBtn && !switchBtn.dataset.bound) {
        switchBtn.dataset.bound = 'true';
        switchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openWorkspaceConnectModal();
        });
    }

    const closeBtn = document.getElementById('workspace-connect-close');
    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', () => {
            closeWorkspaceConnectModal();
        });
    }

    const overlay = document.getElementById('workspace-connect-overlay');
    if (overlay && !overlay.dataset.bound) {
        overlay.dataset.bound = 'true';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeWorkspaceConnectModal();
            }
        });
    }
}

async function initTenantBranding() {
    try {
        const tenant = await getActiveTenant();
        if (!tenant) {
            openWorkspaceConnectModal();
            return;
        }

        closeWorkspaceConnectModal();

        const brandNameEl = document.getElementById('tenant-brand-name');
        const logoWrap = document.getElementById('tenant-logo-wrap');
        const logoImg = document.getElementById('tenant-logo-img');
        const adminBtn = document.getElementById('admin-access-btn');

        if (brandNameEl && tenant.name) {
            brandNameEl.textContent = tenant.name;
            document.title = `${tenant.name} - Attendance`;
        }

        if (tenant.logo_url && logoWrap && logoImg) {
            logoImg.src = tenant.logo_url;
            logoWrap.style.display = 'flex';
        }

        if (tenant.brand_color) {
            document.documentElement.style.setProperty('--primary', tenant.brand_color);
        }

        // Carry tenant slug to admin button
        if (adminBtn && tenant.slug) {
            adminBtn.href = `./admin/index.html?tenant=${encodeURIComponent(tenant.slug)}`;
        }

        const switchBtn = document.getElementById('switch-workspace-btn');
        if (switchBtn && !switchBtn.dataset.bound) {
            switchBtn.dataset.bound = 'true';
            switchBtn.addEventListener('click', () => {
                openWorkspaceConnectModal();
            });
        }
    } catch (e) {
        console.warn('initTenantBranding error:', e);
    }
}

function openDeviceTransferModal() {
    const modal = document.getElementById('device-transfer-modal');
    if (!modal) return;
    const savedName = safeStorage.getItem('saved_name') || getLocalDeviceLockHint() || '';
    const nameEl = document.getElementById('transfer-current-name');
    if (nameEl) nameEl.textContent = savedName || 'Current Employee';
    const pwdInput = document.getElementById('transfer-admin-pwd');
    if (pwdInput) pwdInput.value = '';
    const pwdMsg = document.getElementById('transfer-admin-pwd-msg');
    if (pwdMsg) { pwdMsg.style.display = 'none'; pwdMsg.textContent = ''; }
    const reqMsg = document.getElementById('transfer-request-msg');
    if (reqMsg) { reqMsg.style.display = 'none'; reqMsg.textContent = ''; }
    modal.style.display = 'flex';
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

function closeDeviceTransferModal() {
    const modal = document.getElementById('device-transfer-modal');
    if (modal) modal.style.display = 'none';
}

function initDeviceTransferModal() {
    const closeBtn = document.getElementById('close-transfer-modal-btn');
    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', closeDeviceTransferModal);
    }

    const modal = document.getElementById('device-transfer-modal');
    if (modal && !modal.dataset.bound) {
        modal.dataset.bound = 'true';
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeDeviceTransferModal();
        });
    }

    const confirmAdminBtn = document.getElementById('confirm-admin-unlink-btn');
    if (confirmAdminBtn && !confirmAdminBtn.dataset.bound) {
        confirmAdminBtn.dataset.bound = 'true';
        confirmAdminBtn.addEventListener('click', async () => {
            const pwdInput = document.getElementById('transfer-admin-pwd');
            const msgEl = document.getElementById('transfer-admin-pwd-msg');
            const pwd = pwdInput ? pwdInput.value.trim() : '';
            if (!pwd) {
                if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#ef4444'; msgEl.textContent = 'Please enter admin password.'; }
                return;
            }

            confirmAdminBtn.disabled = true;
            confirmAdminBtn.textContent = 'Checking...';

            try {
                const activeTenant = await getActiveTenant();
                let valid = false;
                if (activeTenant && activeTenant.admin_password && activeTenant.admin_password === pwd) {
                    valid = true;
                } else if (activeTenant && activeTenant.admin_email) {
                    const check = await callBackend({ mode: 'admin-login', email: activeTenant.admin_email, password: pwd });
                    if (check && check.ok) valid = true;
                } else {
                    const check = await callBackend({ mode: 'admin-login', email: 'admin@perimetrr.com', password: pwd });
                    if (check && check.ok) valid = true;
                }

                if (valid) {
                    const savedName = safeStorage.getItem('saved_name') || getLocalDeviceLockHint();
                    if (savedName) {
                        try { await callBackend({ mode: 'unlink-staff-device', name: savedName }); } catch(e) {}
                    }
                    safeStorage.removeItem('saved_name');
                    safeStorage.removeItem('saved_dept');
                    clearLocalDeviceLockHint();
                    if (savedName) clearBiometrics(savedName);

                    closeDeviceTransferModal();
                    initStaffIdentityView();
                    showToast('Device unlocked and reset. You may now select a new employee.', 'success');
                } else {
                    if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#ef4444'; msgEl.textContent = 'Incorrect admin password.'; }
                    showToast('Incorrect administrator password.', 'error');
                }
            } catch(e) {
                if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#ef4444'; msgEl.textContent = 'Could not verify admin password.'; }
            } finally {
                confirmAdminBtn.disabled = false;
                confirmAdminBtn.textContent = 'Unlock';
            }
        });
    }

    const requestTransferBtn = document.getElementById('request-transfer-btn');
    if (requestTransferBtn && !requestTransferBtn.dataset.bound) {
        requestTransferBtn.dataset.bound = 'true';
        requestTransferBtn.addEventListener('click', async () => {
            const reqMsg = document.getElementById('transfer-request-msg');
            const savedName = safeStorage.getItem('saved_name') || getLocalDeviceLockHint();
            requestTransferBtn.disabled = true;
            requestTransferBtn.textContent = 'Sending request...';

            try {
                await recordAnalyticsEvent('device_transfer_requested', { name: savedName });
                if (reqMsg) {
                    reqMsg.style.display = 'block';
                    reqMsg.style.color = '#10b981';
                    reqMsg.textContent = '✓ Transfer request sent to administrator. They will reset your binding remotely.';
                }
                showToast('Device transfer request sent to workspace administrator.', 'success');
            } catch(e) {
                if (reqMsg) {
                    reqMsg.style.display = 'block';
                    reqMsg.style.color = '#ef4444';
                    reqMsg.textContent = 'Could not send request. Please contact your manager directly.';
                }
            } finally {
                requestTransferBtn.disabled = false;
                requestTransferBtn.innerHTML = '<i data-lucide="send" size="14"></i> Send Transfer Request to Admin';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
        });
    }
}

function initKioskModules() {
    initFaqModal();
    initPrivacyModal();
    initWorkspaceConnect();
    initDeviceTransferModal();
    initTenantBranding();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKioskModules);
} else {
    initKioskModules();
}

async function refreshRecentLogsFromDb() {
    const nameSelect = document.getElementById('staff-name');
    const selectedName = nameSelect ? nameSelect.value : '';
    const nameToFetch = selectedName || getLocalDeviceLockHint() || safeStorage.getItem('saved_name') || '';

    if (!nameToFetch) return;
    if (!navigator.onLine) return;

    try {
        const response = await callBackend({ mode: 'list-logs', name: nameToFetch, limit: 10 });
        if (response && response.ok && Array.isArray(response.logs)) {
            const localLogs = readStoredJson(STORAGE_KEYS.recentLog, []);
            
            // Keep local pending/failed/offline entries
            const pendingLogs = localLogs.filter(entry => 
                entry && (entry.status === 'pending' || entry.status === 'failed' || entry.status === 'offline')
            );
            
            // Map DB logs
            const dbLogs = response.logs.map(log => ({
                id: log.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                name: log.name,
                action: log.action,
                timestamp: new Date(log.created_at || `${log.date} ${log.time}`).toISOString(),
                status: 'synced'
            }));
            
            // Reconcile today's DB logs with lastAction & local storage
            const todayKey = getTodayKey();
            const todayDbLogs = response.logs.filter(log => {
                const logDate = log.date || (log.created_at ? log.created_at.split('T')[0] : '');
                return logDate === todayKey;
            });

            if (todayDbLogs.length === 0) {
                // If database has NO records for this user today, wipe any stale today's lastAction
                const currentLastAction = readStoredJson(STORAGE_KEYS.lastAction, null);
                if (currentLastAction && currentLastAction.name === nameToFetch && currentLastAction.date === todayKey) {
                    safeStorage.removeItem(STORAGE_KEYS.lastAction);
                    updateLastActionLabel();
                }
            } else {
                // Synchronize lastAction with the latest record from DB today
                todayDbLogs.sort((a, b) => {
                    const timeA = new Date(a.created_at || `${a.date} ${a.time}`).getTime();
                    const timeB = new Date(b.created_at || `${b.date} ${b.time}`).getTime();
                    return timeB - timeA;
                });
                const latestToday = todayDbLogs[0];
                writeStoredJson(STORAGE_KEYS.lastAction, {
                    date: todayKey,
                    action: latestToday.action,
                    name: nameToFetch,
                    timestamp: new Date(latestToday.created_at || `${latestToday.date} ${latestToday.time}`).toISOString()
                });
                updateLastActionLabel();
            }

            // Merge & Deduplicate
            const merged = [...pendingLogs];
            
            dbLogs.forEach(dbLog => {
                const dbLogTime = new Date(dbLog.timestamp).getTime();
                // Check if this log is already represented in pendingLogs (e.g. within 5 minutes name/action match)
                const isPendingDuplicate = pendingLogs.some(p => {
                    const pTime = new Date(p.timestamp).getTime();
                    return p.name === dbLog.name && 
                        p.action === dbLog.action && 
                        Math.abs(pTime - dbLogTime) < 5 * 60 * 1000;
                });
                if (!isPendingDuplicate) {
                    merged.push(dbLog);
                }
            });
            
            // Sort by timestamp descending
            merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            
            // Slice to MAX_HISTORY_ITEMS
            const finalLogs = merged.slice(0, MAX_HISTORY_ITEMS);
            
            writeStoredJson(STORAGE_KEYS.recentLog, finalLogs);
            renderRecentLog();
            updateActionHeroState();
            
            const lastSyncedSpan = document.getElementById('last-synced');
            if (lastSyncedSpan) {
                const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                lastSyncedSpan.textContent = `Last synced: ${nowStr}`;
            }
        }
    } catch (err) {
        console.warn('refreshRecentLogsFromDb failed:', err.message);
    }
}

async function syncScheduleToMobileNative(name) {
    if (!name) {
        if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
            try {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'UPDATE_SCHEDULE',
                    name: null,
                    schedule: null
                }));
            } catch (e) {}
        }
        return;
    }
    if (!(window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function')) {
        return;
    }

    try {
        // Get current week's Monday date
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(today.getFullYear(), today.getMonth(), diff);
        
        // Format DMY
        const dd = String(monday.getDate()).padStart(2, '0');
        const mm = String(monday.getMonth() + 1).padStart(2, '0');
        const yyyy = monday.getFullYear();
        const weekStartStr = `${dd}/${mm}/${yyyy}`;

        // Call database via get-hybrid-schedule
        const response = await callBackend({ mode: 'get-hybrid-schedule', weekStart: weekStartStr });
        if (response && response.ok && response.schedule) {
            const scheduleData = response.schedule[name];
            if (scheduleData) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'UPDATE_SCHEDULE',
                    name: name,
                    schedule: scheduleData
                }));
            }
        }
    } catch (error) {
        console.warn('Failed to sync WFH schedule to mobile native:', error.message);
    }
}

let currentScheduleCache = {};
let currentScheduleWeekStart = '';

async function updateScheduleBanner(name) {
    const locStatus = document.getElementById('loc-status');
    const distLabel = document.getElementById('distance-label');

    if (!name) {
        currentStaffTodayMode = null;
        if (locStatus) {
            locStatus.innerText = coords ? t('gpsReady', '📍 GPS Ready • Select Name') : t('verifyingGps', 'Verifying GPS...');
            locStatus.className = coords ? 'status ready' : 'status waiting';
        }
        if (distLabel) distLabel.textContent = '';
        updateActionHeroState();
        return;
    }

    try {
        // 1. Check Policy Profile
        const staffObj = staffDirectoryData.find(s => String(s.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());
        const policy = staffObj ? String(staffObj.schedule_policy || '').toLowerCase() : '';

        if (policy === 'field_flexible' || policy === 'executive' || policy === 'flexible_remote') {
            currentStaffTodayMode = 'home';
            if (locStatus) {
                locStatus.innerText = t('flexibleMode', '🏠 Flexible / Remote');
                locStatus.className = 'status ready';
            }
            if (distLabel) distLabel.textContent = '';
            updateActionHeroState();
            return;
        }

        if (policy === 'office_only') {
            currentStaffTodayMode = 'office';
            if (locStatus) {
                locStatus.innerText = coords ? t('officeRequired', '📍 On-site (Required)') : t('verifyingGps', 'Verifying GPS...');
                locStatus.className = coords ? 'status ready' : 'status waiting';
            }
            updateActionHeroState();
            return;
        }

        // 2. Otherwise: Standard Weekly Hybrid Schedule
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const today = new Date();
        const dayName = days[today.getDay()];

        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(today.getFullYear(), today.getMonth(), diff);
        const dd = String(monday.getDate()).padStart(2, '0');
        const mm = String(monday.getMonth() + 1).padStart(2, '0');
        const yyyy = monday.getFullYear();
        const weekStartStr = `${dd}/${mm}/${yyyy}`;

        let schedule = null;
        if (currentScheduleWeekStart === weekStartStr && Object.keys(currentScheduleCache).length > 0) {
            schedule = currentScheduleCache;
        } else {
            const response = await callBackend({ mode: 'get-hybrid-schedule', weekStart: weekStartStr });
            if (response && response.ok && response.schedule) {
                currentScheduleCache = response.schedule;
                currentScheduleWeekStart = weekStartStr;
                schedule = response.schedule;
            }
        }

        let locationVal = '';
        if (schedule) {
            const normalizedName = String(name || '').trim().toLowerCase();
            const candidateKey = Object.keys(schedule).find(k => {
                const nk = String(k || '').trim().toLowerCase();
                return nk === normalizedName || nk.includes(normalizedName) || normalizedName.includes(nk);
            });
            const staffSched = candidateKey ? schedule[candidateKey] : null;
            if (staffSched) {
                if (typeof staffSched === 'object' && !Array.isArray(staffSched)) {
                    locationVal = staffSched[dayName] || staffSched[dayName.toLowerCase()] || '';
                } else if (Array.isArray(staffSched)) {
                    const found = staffSched.find(s => String(s.day || '').toLowerCase() === dayName.toLowerCase());
                    locationVal = found?.location || found?.type || '';
                }
            }
        }

        const normalizedLoc = String(locationVal || '').trim().toLowerCase();
        currentStaffTodayMode = normalizedLoc || 'office';

        if (normalizedLoc === 'home') {
            if (locStatus) {
                locStatus.innerText = t('homeMode', '🏠 Virtual Mode');
                locStatus.className = 'status ready';
            }
            if (distLabel) distLabel.textContent = '';
        } else if (normalizedLoc === 'leave') {
            if (locStatus) {
                locStatus.innerText = t('onLeave', '🌴 On Leave');
                locStatus.className = 'status synced';
            }
            if (distLabel) distLabel.textContent = '';
        } else {
            if (locStatus) {
                locStatus.innerText = coords ? t('officeMode', '📍 Office') : t('verifyingGps', 'Verifying GPS...');
                locStatus.className = coords ? 'status ready' : 'status waiting';
            }
        }
        updateActionHeroState();
    } catch (e) {
        console.warn('updateScheduleBanner error:', e.message);
        currentStaffTodayMode = 'office';
        if (locStatus) {
            locStatus.innerText = coords ? t('officeMode', '📍 Office') : t('verifyingGps', 'Verifying GPS...');
            locStatus.className = coords ? 'status ready' : 'status waiting';
        }
        updateActionHeroState();
    }
}

// React dynamically to real-time language changes across the app
window.addEventListener('languageChanged', () => {
    updateActionHeroState();
    const nameSelect = document.getElementById('staff-name');
    if (nameSelect && nameSelect.value) {
        updateScheduleBanner(nameSelect.value);
    } else {
        const locStatus = document.getElementById('loc-status');
        if (locStatus && !coords) {
            locStatus.innerText = t('verifyingGps', 'Verifying GPS...');
        }
    }
});


