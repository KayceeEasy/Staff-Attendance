/**
 * Shared utilities for Staff Attendance app.
 * Eliminates duplicated DOM access, status updates, and message display logic.
 */

/** Cached DOM element references to avoid repeated getElementById calls. */
const dom = {
    staffName: () => document.getElementById('staff-name'),
    locStatus: () => document.getElementById('loc-status'),
    inBtn: () => document.getElementById('in-btn'),
    outBtn: () => document.getElementById('out-btn'),
    msg: () => document.getElementById('msg'),
    debug: () => document.getElementById('debug'),
};

/**
 * Update the location status badge.
 * @param {'waiting'|'ready'|'error'} type
 * @param {string} text
 */
function setLocationStatus(type, text) {
    const el = dom.locStatus();
    const iconMap = {
        waiting: '<i data-lucide="loader" class="spin" size="14"></i>',
        ready: '<i data-lucide="check-circle" size="14"></i>',
        error: '',
    };
    el.innerHTML = (iconMap[type] || '') + ' ' + text;
    el.className = 'status status--' + type;
    lucide.createIcons();
}

/**
 * Show a user-facing message with consistent styling.
 * @param {string} text
 * @param {'loading'|'success'|'error'} type
 */
function showMessage(text, type) {
    const el = dom.msg();
    el.style.display = 'block';
    el.innerText = text;
    el.className = 'msg--' + type;
}

/**
 * Display debug information (device ID, error details).
 * @param {string} text
 */
function setDebugInfo(text) {
    dom.debug().innerText = text;
}

/**
 * Enable or disable the sign-in/sign-out buttons.
 * @param {boolean} enabled
 */
function setButtonsEnabled(enabled) {
    dom.inBtn().disabled = !enabled;
    dom.outBtn().disabled = !enabled;
}

/**
 * Generate a device fingerprint based on browser/hardware properties.
 * @returns {string}
 */
function getFingerprint() {
    const sig = [
        navigator.userAgent,
        screen.width,
        screen.height,
        navigator.hardwareConcurrency,
    ].join('|');
    return 'id-' + btoa(sig).substr(0, 16);
}
