/**
 * Shared utilities for Lifecard Staff Attendance.
 * Loaded by both index.html and admin/index.html.
 */

const STORAGE_KEYS = {
    pendingQueue: 'attendance_pending_queue',
    recentLog: 'attendance_recent_log',
    lastSynced: 'attendance_last_synced',
    lastAction: 'attendance_last_action',
    pendingAction: 'attendance_pending_action',
    theme: 'attendance_theme',
    deviceLock: 'attendance_device_lock',
    analytics: 'attendance_analytics'
};

// Supabase Initialization
const supabaseUrl = 'https://akhditjeiwjuzvubnacw.supabase.co';
const supabaseKey = 'sb_publishable_9BkVRtmi-6UG15Va5xNHbw_R7J_hKhi';
const supabaseClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
        experimental: { passkey: true }
    }
}) : null;


/* ---------- HTML Escaping ---------- */

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ---------- Analytics/Monitoring ---------- */

function logAnalyticsEvent(type, details = {}) {
    const analytics = readStoredJson(STORAGE_KEYS.analytics, []);
    const event = {
        type,
        details,
        timestamp: new Date().toISOString()
    };
    analytics.unshift(event);
    writeStoredJson(STORAGE_KEYS.analytics, analytics.slice(0, 100));

    if (navigator.onLine) {
        const deviceId = typeof window._deviceId !== 'undefined' ? window._deviceId : '';
        const detailStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
        callBackend({ mode: 'log-analytics', eventType: type, details: detailStr, deviceId }).catch(() => {});
    }
}

function getAnalytics() {
    return readStoredJson(STORAGE_KEYS.analytics, []);
}

function clearAnalytics() {
    writeStoredJson(STORAGE_KEYS.analytics, []);
}


/* ---------- Safe Storage Wrapper ---------- */
window.safeStorage = {
    getItem: (key) => { try { return localStorage.getItem(key); } catch(e) { return null; } },
    setItem: (key, val) => { try { localStorage.setItem(key, val); } catch(e) {} },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch(e) {} }
};

window.safeSession = {
    getItem: (key) => { try { return sessionStorage.getItem(key); } catch(e) { return null; } },
    setItem: (key, val) => { try { sessionStorage.setItem(key, val); } catch(e) {} },
    removeItem: (key) => { try { sessionStorage.removeItem(key); } catch(e) {} }
};

/* ---------- Storage helpers ---------- */

function readStoredJson(key, fallback = []) {
    try {
        const value = safeStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.warn(`Failed to parse stored value for "${key}":`, error);
        return fallback;
    }
}

function writeStoredJson(key, value) {
    try {
        safeStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Failed to persist value for "${key}":`, error);
    }
}

/* ---------- Crypto: SHA-256 hashing ---------- */

async function sha256Hex(text) {
    if (!window.crypto || !window.crypto.subtle) {
        throw new Error('Web Crypto API is unavailable in this browser context (requires HTTPS or localhost).');
    }
    const data = new TextEncoder().encode(text);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/* ---------- Request deduplication ---------- */

const pendingRequests = new Map();

async function callBackendDeduplicated(payload, timeoutMs = 20000) {
    const requestKey = JSON.stringify(payload);
    
    if (pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }
    
    const promise = callBackend(payload, timeoutMs)
        .finally(() => {
            pendingRequests.delete(requestKey);
        });
    
    pendingRequests.set(requestKey, promise);
    return promise;
}

/* ---------- Backend communication ----------
   Routes requests to Supabase (PostgreSQL + Edge RPCs). */

async function callBackend(payload, timeoutMs = 20000) {
    if (!supabaseClient) return { ok: false, message: 'Supabase client not loaded.' };
    const adminToken = payload.adminToken || safeSession.getItem('admin_token') || '';
    const mode = payload.mode;
    
    try {
        switch (mode) {
            case 'admin-login': {
                // True Supabase Auth Login
                const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                    email: payload.email,
                    password: payload.password
                });
                if (authError) throw authError;
                
                // Fetch their role from admin_roles
                const { data: roleData, error: roleError } = await supabaseClient.from('admin_roles').select('role').eq('id', authData.user.id).single();
                if (roleError) throw roleError;

                return {
                    ok: true,
                    message: 'Admin access granted.',
                    role: roleData.role,
                    isSuperuser: roleData.role === 'developer',
                    username: payload.email
                };
            }
            case 'admin-logout': {
                await supabaseClient.auth.signOut();
                return { ok: true, message: 'Logged out.' };
            }
            case 'attendance': {
                const { data, error } = await supabaseClient.rpc('process_attendance', {
                    p_name: payload.name,
                    p_action: payload.action,
                    p_lat: payload.lat,
                    p_lon: payload.lon,
                    p_device_id: payload.deviceId || ''
                });
                if (error) throw error;
                return {
                    ok: data.ok,
                    allowed: data.ok,
                    message: data.message,
                    status: data.status,
                    distance: data.distance,
                    raw: data
                };
            }
            case 'list-staff': {
                const { data, error } = await supabaseClient.from('staff').select('*').order('name');
                if (error) throw error;
                return { ok: true, allowed: true, staff: data };
            }
            case 'list-logs': {
                let query = supabaseClient.from('attendance_logs').select('*');
                if (payload.name) {
                    query = query.ilike('name', `%${payload.name}%`);
                }
                if (payload.fromDate) {
                    query = query.gte('date', payload.fromDate);
                }
                if (payload.toDate) {
                    query = query.lte('date', payload.toDate);
                }
                query = query.order('id', { ascending: false }).limit(payload.limit || 500);
                const { data, error } = await query;
                if (error) throw error;
                return { ok: true, allowed: true, logs: data };
            }
            case 'list-distance-alerts': {
                const { data, error } = await supabaseClient.from('distance_alerts').select('*').order('id', { ascending: false }).limit(200);
                if (error) throw error;
                return { ok: true, allowed: true, logs: data }; // admin.js expects 'logs' property for alerts too sometimes, or 'alerts'
            }
            case 'list-audit-logs': {
                const { data, error } = await supabaseClient.from('audit_logs').select('*').order('id', { ascending: false }).limit(200);
                if (error) throw error;
                return { ok: true, allowed: true, logs: data };
            }
            case 'log-analytics': {
                // Not strictly necessary for core function, but we can log it
                const { error } = await supabaseClient.from('audit_logs').insert([{
                    date: new Date().toLocaleDateString(),
                    time: new Date().toLocaleTimeString(),
                    category: 'Analytics',
                    event_type: payload.eventType,
                    user_staff: payload.deviceId || 'System',
                    details: payload.details
                }]);
                if (error) throw error;
                return { ok: true, message: 'Logged' };
            }
            case 'add-staff': {
                const { error } = await supabaseClient.from('staff').insert([{ name: payload.name }]);
                if (error) throw error;
                return { ok: true, message: 'Staff added successfully.' };
            }
            case 'remove-staff': {
                const { error } = await supabaseClient.from('staff').delete().eq('name', payload.name);
                if (error) throw error;
                return { ok: true, message: 'Staff removed successfully.' };
            }
            case 'reset-staff-lock': {
                const { error } = await supabaseClient.from('staff').update({ device_id: null }).eq('name', payload.name);
                if (error) throw error;
                return { ok: true, message: 'Device lock reset.' };
            }
            case 'reset-all-locks': {
                // Supabase doesn't easily allow update all without a filter if RLS is tricky, but we can do neq
                const { error } = await supabaseClient.from('staff').update({ device_id: null }).neq('name', 'invalid_dummy_name_123');
                if (error) throw error;
                return { ok: true, message: 'All device locks reset.' };
            }
            case 'get-config': {
                const { data, error } = await supabaseClient.from('app_config').select('*');
                if (error) throw error;
                const configObj = {};
                data.forEach(row => configObj[row.key] = row.value);
                return { ok: true, config: configObj };
            }
            case 'update-config': {
                const { error } = await supabaseClient.from('app_config').update({ value: payload.value }).eq('key', payload.key);
                if (error) throw error;
                return { ok: true, message: 'Configuration updated.' };
            }
            case 'list-admin-users': {
                const { data, error } = await supabaseClient.from('admin_roles').select('*');
                if (error) throw error;
                return { ok: true, users: data || [] };
            }
            case 'add-admin-user': {
                const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                    email: payload.email,
                    password: payload.password
                });
                if (authError) throw authError;
                if (authData && authData.user) {
                    const { error: roleError } = await supabaseClient.from('admin_roles').insert([{
                        id: authData.user.id,
                        role: payload.role || 'admin'
                    }]);
                    if (roleError) throw roleError;
                }
                return { ok: true, message: 'Admin user added successfully.' };
            }
            case 'remove-admin-user': {
                const { error } = await supabaseClient.from('admin_roles').delete().eq('id', payload.userId);
                if (error) throw error;
                return { ok: true, message: 'Admin user removed.' };
            }
            case 'get-hybrid-schedule': {
                const { data, error } = await supabaseClient
                    .from('hybrid_schedules')
                    .select('schedule_data')
                    .eq('week_key', payload.weekStart)
                    .single();
                
                if (error) {
                    // It's perfectly normal for a week to not have a schedule yet
                    if (error.code === 'PGRST116') {
                        return { ok: true, data: {} };
                    }
                    throw error;
                }
                
                return data.schedule_data;
            }
            case 'claim-account': {
                const { data, error } = await supabaseClient.rpc('claim_account', {
                    p_name: payload.name,
                    p_device_id: payload.deviceId || ''
                });
                if (error) throw error;
                return {
                    ok: data.ok,
                    allowed: data.ok,
                    email: data.email,
                    password: data.password,
                    message: data.message
                };
            }
            case 'verify-owner':
            case 'verify-user': {
                const { data, error } = await supabaseClient.from('staff').select('device_id').eq('name', payload.name).single();
                if (error) return { ok: false, allowed: false, message: 'Staff member not found.' };
                if (!data.device_id) return { ok: true, allowed: true, message: 'No device locked yet.' };
                if (data.device_id === payload.deviceId) return { ok: true, allowed: true, message: 'Device verified.' };
                
                // If it doesn't match, we need to return the conflictOwner name so the UI can display it
                // We don't store owner name on the device, we store device on the owner. 
                // So let's find who owns this device.
                const { data: conflictData } = await supabaseClient.from('staff').select('name').eq('device_id', payload.deviceId).single();
                const conflictOwner = conflictData ? conflictData.name : 'another user';
                return { ok: false, allowed: false, message: `This device is already registered to ${conflictOwner}. Device sharing is not allowed.` };
            }
            case 'register-owner': {
                // Read current device_id
                const { data, error } = await supabaseClient.from('staff').select('device_id').eq('name', payload.name).single();
                if (error) return { ok: false, allowed: false, message: 'Staff member not found.' };
                
                // If already registered to this device, success
                if (data.device_id === payload.deviceId) return { ok: true, allowed: true };
                
                // If registered to a DIFFERENT device, fail
                if (data.device_id) return { ok: false, allowed: false, message: 'Already registered to another device.' };
                
                // Otherwise, register it
                const { error: updateError } = await supabaseClient.from('staff').update({ device_id: payload.deviceId }).eq('name', payload.name);
                if (updateError) throw updateError;
                return { ok: true, allowed: true, message: 'Device registered successfully.' };
            }
            case 'reassign-owner': {
                // Check if the resetCodeHash matches the dev or admin password
                // This is a bit tricky without a backend, but we'll try to validate it
                // Actually, the original GAS implementation checked if `payload.resetCodeHash` matched `accounts[..].passwordHash`
                // For Supabase, the admin would normally use the admin dashboard to reset locks.
                // If the user tries to do it from the frontend via reassign-owner, let's just let the admin dashboard handle it via `reset-staff-lock`.
                // The frontend `reassignDeviceOwnership` is a fallback that might not be fully needed since admin panel works.
                // Let's implement it by checking if the resetCode matches a config value or just reject it and tell them to see admin.
                return { ok: false, allowed: false, message: 'Please see the administrator to reset your device lock.' };
            }
            default:
                // For unmapped endpoints, return false so the UI knows it's not implemented yet
                return { ok: false, allowed: false, message: `Endpoint '${mode}' is not implemented in Supabase yet.` };
        }
    } catch (err) {
        console.error('Supabase Error:', err);
        return { ok: false, allowed: false, message: err.message || 'Database error.' };
    }
}

function normalizeBackendResponse(data) {
    if (!data) return { ok: false, allowed: false, message: 'No response from backend.', raw: null };
    if (data.result !== undefined) {
        const normalized = normalizeBackendResponse(data.result);
        if (normalized.raw === null && typeof data.result === 'string') {
            normalized.raw = data.result;
        }
        return normalized;
    }
    if (typeof data === 'string') {
        const parts = data.split('|');
        const isSuccess = ['WELCOME', 'LATE', 'NORMAL'].includes(parts[0]);
        return { ok: isSuccess, allowed: isSuccess, message: parts[1] || data, raw: data };
    }
    return {
        ok: data.ok === true || data.allowed === true,
        allowed: data.allowed === true || data.ok === true,
        message: data.message || data.result || 'Backend response received.',
        staff: data.staff || null,
        owner: data.owner || data.deviceOwner || null,
        logs: data.logs || null,
        config: data.config || null,
        schedule: data.schedule || null,
        csrfToken: data.csrfToken || null,
        adminToken: data.adminToken || null,
        raw: null
    };
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
    const root = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    const isDark = theme === 'dark';
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (toggle) {
        toggle.textContent = isDark ? 'Light' : 'Dark';
        toggle.setAttribute('aria-pressed', String(isDark));
        toggle.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
    try {
        safeStorage.setItem(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');
    } catch (e) {
        console.warn('localStorage not available:', e);
    }
}

function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    
    let saved = null;
    try {
        saved = safeStorage.getItem(STORAGE_KEYS.theme);
    } catch (e) {
        console.warn('localStorage not available:', e);
    }
    
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved === 'dark' || (!saved && prefersDark) ? 'dark' : 'light');
    
    toggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
    });
}

/* ---------- Hard refresh ---------- */

async function hardRefresh() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
    }
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((reg) => reg.unregister()));
        }
        if (window.caches && caches.keys) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
        }
    } catch (error) {
        console.warn('Error clearing service worker/cache during refresh:', error);
    } finally {
        window.location.reload();
    }
}

function initRefreshButton() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', hardRefresh);
    }
}

/* ---------- Show/hide password toggle ---------- */

function initPasswordToggle(toggleEl) {
    const targetId = toggleEl.getAttribute('data-toggle-target');
    const input = document.getElementById(targetId);
    if (!input || toggleEl.dataset.toggleBound) return;
    toggleEl.dataset.toggleBound = 'true';

    const syncToggleState = () => {
        const isHidden = input.type === 'password';
        toggleEl.textContent = isHidden ? '👁' : '🙈';
        toggleEl.setAttribute('aria-label', isHidden ? 'Show password' : 'Hide password');
        toggleEl.classList.toggle('visible', !isHidden);
    };

    syncToggleState();
    toggleEl.addEventListener('click', () => {
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        syncToggleState();
    });
}

function initAllPasswordToggles(root = document) {
    root.querySelectorAll('[data-toggle-target]').forEach(initPasswordToggle);
}

/* ---------- Formatting ---------- */

function formatTimestamp(isoString) {
    if (!isoString) return 'Pending';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDateDisplay(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getTodayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/* ---------- Toast notifications ---------- */

let toastTimer = null;

function showToast(message, type = 'default', durationMs = 3200) {
    let toastEl = document.getElementById('app-toast');
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'app-toast';
        toastEl.className = 'toast';
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.className = `toast visible${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastEl.classList.remove('visible');
    }, durationMs);
}

/* ---------- Inline dialog ---------- */

function showInlineDialog({ title, message, fields = [], confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, customContentHtml = '' }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        const fieldsHtml = fields.map((field, idx) => {
            const inputId = `dialog-field-${idx}`;
            if (field.type === 'select') {
                const optionsHtml = (field.options || []).map(opt => `
                    <option value="${escapeHtml(opt.value)}" ${field.value === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
                `).join('');
                return `
                    <select id="${inputId}" class="dialog-select" style="width:100%; padding:8px 12px; margin-bottom:12px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:0.88rem;">
                        ${optionsHtml}
                    </select>
                `;
            }

            const input = `
                <input
                    id="${inputId}"
                    type="${field.type || 'text'}"
                    placeholder="${escapeHtml(field.placeholder || '')}"
                    autocomplete="${field.autocomplete || 'off'}"
                />
            `;
            if (field.type === 'password') {
                return `
                    <div class="password-field-wrap">
                        ${input}
                        <button type="button" class="password-toggle" data-toggle-target="${inputId}" aria-label="Show password">👁</button>
                    </div>
                `;
            }
            return input;
        }).join('');
        overlay.innerHTML = `
            <div class="dialog-box">
                <h3>${escapeHtml(title)}</h3>
                ${message ? `<p>${escapeHtml(message)}</p>` : ''}
                ${fieldsHtml}
                ${customContentHtml}
                <div class="dialog-actions">
                    <button type="button" class="admin-btn secondary" data-action="cancel">${escapeHtml(cancelLabel)}</button>
                    <button type="button" class="admin-btn${danger ? ' danger' : ''}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        initAllPasswordToggles(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(null));
        overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
            const values = fields.map((field, idx) => {
                const raw = overlay.querySelector(`#dialog-field-${idx}`).value;
                return field.type === 'password' ? raw : raw.trim();
            });
            if (fields.length && values.some((v) => !v)) {
                showToast('Please fill in all fields.', 'error');
                return;
            }
            // Capture all custom select/input values before overlay removal
            const customSelects = overlay.querySelectorAll('select');
            customSelects.forEach(sel => {
                if (sel.id) window['_dialogVal_' + sel.id] = sel.value;
            });
            cleanup(fields.length ? values : true);
        });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup(null);
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') cleanup(null);
        });

        const firstInput = overlay.querySelector('input');
        if (firstInput) firstInput.focus();
    });
}

function confirmDialog(message, { danger = false, confirmLabel = 'Confirm', title = 'Please confirm' } = {}) {
    return showInlineDialog({ title, message, confirmLabel, danger }).then((result) => result === true);
}

function promptDialog(title, placeholder = '', type = 'text') {
    return showInlineDialog({ title, fields: [{ placeholder, type }] }).then((result) => (result ? result[0] : null));
}
