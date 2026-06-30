/**
 * Shared utilities for Lifecard Staff Attendance.
 * Loaded by both index.html and admin/index.html.
 */

const STORAGE_KEYS = {
    pendingQueue: 'attendance_pending_queue',
    recentLog: 'attendance_recent_log',
    lastSynced: 'attendance_last_synced',
    lastAction: 'attendance_last_action',
    theme: 'attendance_theme',
    deviceLock: 'attendance_device_lock'
};

/* ---------- Storage helpers ---------- */

function readStoredJson(key, fallback = []) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.warn(`Failed to parse stored value for "${key}":`, error);
        return fallback;
    }
}

function writeStoredJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Failed to persist value for "${key}":`, error);
    }
}

/* ---------- Crypto: SHA-256 hashing ----------
   Used so passwords/reset codes are never sent in plaintext,
   even over the GET/JSONP fallback path. */

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

/* ---------- Backend communication ----------
   Strategy: try doPost (JSON body, no secrets in URL) first.
   If that fails (network error, CORS issue, or Apps Script quirk),
   fall back to JSONP GET. Any secret fields in the payload must
   already be hashed by the caller before calling this function -
   callBackend never receives raw passwords. */

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxw2NO8BwcVYdiHyZfzVFFkY_D8VTaBBuMayNcRWopDFAi0PKwiuOKXZxJXVyPZvEP0-w/exec';

function injectBackendScript(url, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
        const callbackName = `cb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        let settled = false;

        const cleanup = () => {
            delete window[callbackName];
            if (script.parentNode) script.parentNode.removeChild(script);
            clearTimeout(timer);
        };

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Backend request timed out.'));
        }, timeoutMs);

        window[callbackName] = (data) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(data);
        };

        const script = document.createElement('script');
        script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${callbackName}`;
        script.async = true;
        script.onerror = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Failed to load backend script (network or CORS error).'));
        };
        document.body.appendChild(script);
    });
}

/**
 * Calls the backend. Tries POST with a JSON body first (keeps payload
 * out of any URL/server log). Falls back to JSONP GET if POST fails
 * for any reason (Apps Script CORS handling is inconsistent across
 * deployment configurations).
 *
 * IMPORTANT: callers must hash any secret fields (passwords, reset
 * codes) before passing them in - this function does not hash anything,
 * it just transports the payload via whichever channel works.
 *
 * @param {Object} payload - must include `mode`
 * @param {number} timeoutMs
 * @returns {Promise<Object>} normalized backend response
 */
async function callBackend(payload, timeoutMs = 12000) {
    // Attempt 1: POST with JSON body.
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`POST failed with status ${response.status}`);
        const data = await response.json();
        return normalizeBackendResponse(data);
    } catch (postError) {
        console.warn('POST to backend failed, falling back to JSONP GET:', postError.message);
    }

    // Attempt 2: JSONP GET fallback.
    try {
        const params = new URLSearchParams();
        Object.entries(payload).forEach(([key, value]) => {
            if (value !== undefined && value !== null) params.set(key, value);
        });
        const data = await injectBackendScript(`${SCRIPT_URL}?${params.toString()}`, timeoutMs);
        return normalizeBackendResponse(data);
    } catch (getError) {
        return { ok: false, allowed: false, message: 'Could not reach the server. Check your connection and try again.' };
    }
}

function normalizeBackendResponse(data) {
    if (!data) return { ok: false, allowed: false, message: 'No response from backend.', raw: null };
    if (data.result !== undefined) {
        const normalized = normalizeBackendResponse(data.result);
        // Preserve the raw STATUS|message string one level up so callers
        // that need the original status code (e.g. WELCOME/LATE/BLOCK for
        // attendance) can still parse it, even though we already derived
        // ok/allowed/message from it here.
        if (normalized.raw === null && typeof data.result === 'string') {
            normalized.raw = data.result;
        }
        return normalized;
    }
    if (typeof data === 'string') {
        const lower = data.toLowerCase();
        const negative = lower.includes('denied') || lower.includes('block');
        return { ok: !negative, allowed: !negative, message: data, raw: data };
    }
    return {
        ok: data.ok === true || data.allowed === true,
        allowed: data.allowed === true || data.ok === true,
        message: data.message || data.result || 'Backend response received.',
        staff: data.staff || null,
        owner: data.owner || data.deviceOwner || null,
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
    localStorage.setItem(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');
}

function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
    applyTheme(savedTheme === 'dark' ? 'dark' : 'light');
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            applyTheme(next);
        });
    }
}

/* ---------- Hard refresh ----------
   A normal location.reload() can still serve a stale cached version
   if a service worker is installed, which defeats the point of a
   manual refresh button. This unregisters the service worker, clears
   its caches, then reloads - guaranteeing the latest deployed files
   are fetched. Wired up to any #refresh-btn present on the page. */

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

/* ---------- Formatting ---------- */

function formatTimestamp(isoString) {
    if (!isoString) return 'Pending';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

/* ---------- Toast notifications (replaces alert()) ---------- */

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

/* ---------- Inline dialog (replaces confirm()/prompt()) ----------
   Returns a Promise. Resolves null if cancelled, otherwise resolves
   true (for confirm-only dialogs) or an array of field values. */

function showInlineDialog({ title, message, fields = [], confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        const fieldsHtml = fields.map((field, idx) => `
            <input
                id="dialog-field-${idx}"
                type="${field.type || 'text'}"
                placeholder="${field.placeholder || ''}"
                autocomplete="${field.autocomplete || 'off'}"
            />
        `).join('');
        overlay.innerHTML = `
            <div class="dialog-box">
                <h3>${title}</h3>
                ${message ? `<p>${message}</p>` : ''}
                ${fieldsHtml}
                <div class="dialog-actions">
                    <button type="button" class="admin-btn secondary" data-action="cancel">${cancelLabel}</button>
                    <button type="button" class="admin-btn${danger ? ' danger' : ''}" data-action="confirm">${confirmLabel}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(null));
        overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
            const values = fields.map((_, idx) => overlay.querySelector(`#dialog-field-${idx}`).value.trim());
            if (fields.length && values.some((v) => !v)) {
                showToast('Please fill in all fields.', 'error');
                return;
            }
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
