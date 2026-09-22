function setHtmlIfChanged(element, newHtml) { if (!element) return false; if (element.innerHTML !== newHtml) { element.innerHTML = newHtml; return true; } return false; }

/**
 * Admin console logic.
 * Tabbed interface with weekly navigation, session timeout, hybrid schedule.
 * Depends on ../common.js being loaded first.
 */

let isAdminLoggedIn = false;
let currentAdminUsername = '';
let currentTab = 'dashboard';
let autoRefreshTimer = null;
let allStaffList = [];
let cachedWeekData = {};
let currentWeekStart = null;
let hybridScheduleCache = {};
let logsSortField = 'id';
let logsSortAsc = false;
let tenantWfhQuotaEnabled = true;
let tenantLateCutoffMinutes = 510;
let tenantClosingMinutes = 1020;
let tenantTimezone = 'Africa/Lagos';

// Session timeout (15 min idle sliding window inactivity → 60s countdown)
let inactivityTimer = null;
let sessionCountdownTimer = null;
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const SESSION_COUNTDOWN_MS = 60 * 1000;

/* ---------- Auth ---------- */

async function authenticateAdmin(email, password) {
    // True Supabase Auth handles hashing internally. We pass the raw password.
    return callBackend({ mode: 'admin-login', email, password });
}

async function changeAdminPassword(username, currentPassword, newPassword) {
    return callBackend({ mode: 'admin-change-password', username, newPassword });
}

async function setRecoveryEmail(username, currentPassword, email) {
    const currentPasswordHash = await sha256Hex(currentPassword);
    const adminToken = safeSession.getItem('admin_token') || currentPasswordHash;
    const csrfToken = safeSession.getItem('admin_csrf_token') || '';
    return callBackend({ mode: 'admin-set-recovery-email', username, currentPasswordHash, email, adminToken, csrfToken });
}

async function requestPasswordResetCode(username) {
    return callBackend({ mode: 'admin-forgot-password-request', username });
}

async function confirmPasswordReset(username, code, newPassword) {
    const newPasswordHash = await sha256Hex(newPassword);
    return callBackend({ mode: 'admin-forgot-password-confirm', username, code, newPasswordHash });
}

/* ---------- API ---------- */

async function listStaff() {
    return callBackend({ mode: 'list-staff' });
}

async function addStaff(name, dept = 'General', schedule_policy = 'weekly_hybrid', is_team_lead = false, include_in_reports = true) {
    return callBackend({ mode: 'add-staff', name, dept, schedule_policy, is_team_lead, include_in_reports });
}

async function updateStaff(name, updates = {}) {
    return callBackend({ mode: 'update-staff', name, ...updates });
}

async function removeStaffRecord(name) {
    return callBackend({ mode: 'remove-staff', name });
}

async function resetStaffLock(name) {
    return callBackend({ mode: 'reset-staff-lock', name });
}

async function resetAllLocks() {
    return callBackend({ mode: 'reset-all-locks' });
}

async function fetchLogs(filters = {}) {
    return callBackend({ mode: 'list-logs', ...filters });
}

async function fetchHybridSchedule(weekStart, forceRefresh = false) {
    if (!forceRefresh && hybridScheduleCache[weekStart] && Object.keys(hybridScheduleCache[weekStart]).length) {
        return hybridScheduleCache[weekStart];
    }

    try {
        const response = await callBackend({ mode: 'get-hybrid-schedule', weekStart });
        let schedule = null;
        
        if (response && response.ok && response.schedule && Object.keys(response.schedule).length) {
            schedule = response.schedule;
        } else {
            const possibleFields = ['schedule', 'result', 'data', 'raw', 'payload', 'scheduleJson'];
            for (const f of possibleFields) {
                const candidate = response && response[f];
                if (!candidate) continue;
                if (typeof candidate === 'object' && Object.keys(candidate).length) {
                    schedule = candidate;
                    break;
                }
                if (typeof candidate === 'string') {
                    try {
                        const parsed = JSON.parse(candidate);
                        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
                            schedule = parsed;
                            break;
                        }
                    } catch (e) {}
                }
            }
        }
        
        if (schedule && Object.keys(schedule).length) {
            hybridScheduleCache[weekStart] = schedule;
        } else if (hybridScheduleCache[weekStart]) {
            schedule = hybridScheduleCache[weekStart];
        }
        
        return schedule || {};
    } catch (e) {
        console.warn('Could not fetch hybrid schedule:', e);
        if (hybridScheduleCache[weekStart] && Object.keys(hybridScheduleCache[weekStart]).length) {
            return hybridScheduleCache[weekStart];
        }
        return {};
    }
}

const AUTO_REFRESH_MS = 60000;

function startAutoRefresh() {
    clearAutoRefresh();
    autoRefreshTimer = setInterval(() => {
        if (!isAdminLoggedIn) { clearAutoRefresh(); return; }
        const timeoutOverlay = document.querySelector('.session-timeout-overlay');
        if (timeoutOverlay) return;
        
        refreshCurrentTab();
    }, AUTO_REFRESH_MS);
}

function clearAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

function refreshCurrentTab() {
    if (!isAdminLoggedIn) return;
    const activeTabBtn = document.querySelector('.admin-tabs .tab-btn.active');
    const activeTab = activeTabBtn ? activeTabBtn.dataset.tab : 'dashboard';
    if (activeTab === 'dashboard') {
        loadWeekData(true);
    } else if (activeTab === 'logs') {
        loadLogsViewer(true);
    } else if (activeTab === 'analytics') {
        loadAnalytics(null, null, null, true);
    } else if (activeTab === 'staff') {
        loadStaffList(true);
    }
}

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    clearInterval(sessionCountdownTimer);
    
    const existingOverlay = document.querySelector('.session-timeout-overlay');
    if (existingOverlay) existingOverlay.remove();
    
    inactivityTimer = setTimeout(showSessionTimeoutWarning, SESSION_TIMEOUT_MS);
}

function showSessionTimeoutWarning() {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay session-timeout-overlay';
    overlay.innerHTML = `
        <div class="dialog-box session-timeout-dialog">
            <h3><i data-lucide="clock" size="18" style="vertical-align:middle; margin-right:6px;"></i> Are you still there?</h3>
            <p>This session will timeout in <strong id="session-countdown">30</strong> seconds due to inactivity.</p>
            <div class="dialog-actions" style="grid-template-columns: 1fr;">
                <button id="session-here-btn" class="btn-in" type="button"><i data-lucide="check" size="16" style="vertical-align:middle; margin-right:4px;"></i> I'm here</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    
    const countdownEl = document.getElementById('session-countdown');
    let secondsLeft = 30;
    
    sessionCountdownTimer = setInterval(() => {
        secondsLeft--;
        if (countdownEl) countdownEl.textContent = secondsLeft;
        if (secondsLeft <= 0) {
            clearInterval(sessionCountdownTimer);
            handleLogout(true);
        }
    }, 1000);
    
    document.getElementById('session-here-btn').addEventListener('click', () => {
        clearInterval(sessionCountdownTimer);
        overlay.remove();
        resetInactivityTimer();
    });
}

function clearAdminLoginForm() {
    const form = document.getElementById('admin-login-form');
    const usernameInput = document.getElementById('admin-email');
    const passwordInput = document.getElementById('admin-password');
    const messageEl = document.getElementById('admin-message');

    if (form) form.reset();
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) {
        passwordInput.value = '';
        passwordInput.type = 'password';
    }
    if (messageEl) {
        messageEl.textContent = '';
        messageEl.className = 'admin-message';
    }
}

function handleLogout(isTimeout = false) {
    clearTimeout(inactivityTimer);
    clearInterval(sessionCountdownTimer);
    clearAutoRefresh();
    safeSession.removeItem('admin_session');
    safeSession.removeItem('admin_csrf_token');
    safeSession.removeItem('admin_token');
    safeSession.removeItem('admin_username');
    isAdminLoggedIn = false;
    currentAdminUsername = '';
    cachedWeekData = {};
    hybridScheduleCache = {};
    clearAdminLoginForm();
    
    const timeoutOverlay = document.querySelector('.session-timeout-overlay');
    if (timeoutOverlay) timeoutOverlay.remove();
    
    document.getElementById('admin-panel-host').innerHTML = '';
    document.getElementById('admin-login-form').style.display = 'grid';
    document.getElementById('forgot-password-link').style.display = 'block';
    const hero = document.querySelector('.admin-hero');
    if (hero) hero.style.display = 'flex';
    
    if (isTimeout) {
        showToast('Session timed out due to inactivity.', 'error');
    }
}

/* ---------- Week Navigation ---------- */

function getWeekRange(mondayDate) {
    if (!mondayDate) {
        mondayDate = new Date();
        const day = mondayDate.getDay();
        const diff = mondayDate.getDate() - day + (day === 0 ? -6 : 1);
        mondayDate = new Date(mondayDate.getFullYear(), mondayDate.getMonth(), diff);
    }
    const friday = new Date(mondayDate);
    friday.setDate(mondayDate.getDate() + 4);
    return { monday: mondayDate, friday: friday };
}

function formatDateDMY(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function formatMinutesAsTime(minutes) {
    if (minutes === undefined || minutes === null) return '';
    let hh = Math.floor(minutes / 60);
    const mm = String(minutes % 60).padStart(2, '0');
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12;
    if (hh === 0) hh = 12;
    return `${hh}:${mm} ${ampm}`;
}

const GLOBAL_TIMEZONES = [
    { id: 'Africa/Lagos', label: 'West Africa (Lagos, Abuja)', offset: 'GMT+1', flag: '🇳🇬' },
    { id: 'Africa/Accra', label: 'Ghana (Accra)', offset: 'GMT+0', flag: '🇬🇭' },
    { id: 'Africa/Johannesburg', label: 'South Africa (Johannesburg, Cape Town)', offset: 'GMT+2', flag: '🇿🇦' },
    { id: 'Africa/Cairo', label: 'Egypt (Cairo)', offset: 'GMT+2', flag: '🇪🇬' },
    { id: 'Africa/Nairobi', label: 'East Africa (Nairobi)', offset: 'GMT+3', flag: '🇰🇪' },
    { id: 'Europe/London', label: 'United Kingdom (London, Dublin)', offset: 'GMT/BST', flag: '🇬🇧' },
    { id: 'Europe/Paris', label: 'Central Europe (Paris, Berlin, Rome, Madrid)', offset: 'GMT+1 / CET', flag: '🇪🇺' },
    { id: 'Europe/Amsterdam', label: 'Netherlands (Amsterdam)', offset: 'GMT+1 / CET', flag: '🇳🇱' },
    { id: 'America/New_York', label: 'US Eastern (New York, Miami, Atlanta)', offset: 'GMT-5 / EST', flag: '🇺🇸' },
    { id: 'America/Chicago', label: 'US Central (Chicago, Dallas, Houston)', offset: 'GMT-6 / CST', flag: '🇺🇸' },
    { id: 'America/Denver', label: 'US Mountain (Denver, Phoenix)', offset: 'GMT-7 / MST', flag: '🇺🇸' },
    { id: 'America/Los_Angeles', label: 'US Pacific (Los Angeles, San Francisco, Seattle)', offset: 'GMT-8 / PST', flag: '🇺🇸' },
    { id: 'America/Toronto', label: 'Canada (Toronto, Montreal)', offset: 'GMT-5 / EST', flag: '🇨🇦' },
    { id: 'America/Vancouver', label: 'Canada (Vancouver)', offset: 'GMT-8 / PST', flag: '🇨🇦' },
    { id: 'Asia/Dubai', label: 'Gulf (Dubai, Abu Dhabi)', offset: 'GMT+4 / GST', flag: '🇦🇪' },
    { id: 'Asia/Riyadh', label: 'Saudi Arabia (Riyadh)', offset: 'GMT+3 / AST', flag: '🇸🇦' },
    { id: 'Asia/Kolkata', label: 'India (New Delhi, Mumbai, Bengaluru)', offset: 'GMT+5:30 / IST', flag: '🇮🇳' },
    { id: 'Asia/Singapore', label: 'Singapore', offset: 'GMT+8 / SGT', flag: '🇸🇬' },
    { id: 'Asia/Hong_Kong', label: 'Hong Kong', offset: 'GMT+8 / HKT', flag: '🇭🇰' },
    { id: 'Asia/Tokyo', label: 'Japan (Tokyo)', offset: 'GMT+9 / JST', flag: '🇯🇵' },
    { id: 'Australia/Sydney', label: 'Australia (Sydney, Melbourne)', offset: 'GMT+10 / AEST', flag: '🇦🇺' },
    { id: 'Australia/Perth', label: 'Australia (Perth)', offset: 'GMT+8 / AWST', flag: '🇦🇺' },
    { id: 'UTC', label: 'UTC (Coordinated Universal Time)', offset: 'GMT+0', flag: '🌐' }
];

function formatTimezoneLabel(tzId) {
    const found = GLOBAL_TIMEZONES.find(t => t.id === tzId);
    if (found) return `${found.label} (${found.offset})`;
    return tzId || 'Africa/Lagos (GMT+1)';
}

function minutesToTimeComponents(totalMinutes) {
    const safeMin = Math.max(0, Math.min(1439, Number(totalMinutes) || 0));
    let hh24 = Math.floor(safeMin / 60);
    const mm = safeMin % 60;
    const ampm = hh24 >= 12 ? 'PM' : 'AM';
    let hh12 = hh24 % 12;
    if (hh12 === 0) hh12 = 12;
    return { hh12, mm, ampm, totalMinutes: safeMin };
}

function timeComponentsToMinutes(hh12, mm, ampm) {
    let hh = Number(hh12) % 12;
    if (ampm === 'PM') hh += 12;
    return hh * 60 + Number(mm);
}

function openTimezoneModal() {
    const currentTz = tenantTimezone || 'Africa/Lagos';
    let selectedTz = currentTz;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    function renderList(query = '') {
        const q = query.trim().toLowerCase();
        const filtered = GLOBAL_TIMEZONES.filter(t => 
            !q || t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) || t.offset.toLowerCase().includes(q)
        );

        if (!filtered.length) {
            return '<div style="padding:14px; text-align:center; color:var(--text-muted); font-size:0.84rem;">No matching timezones found.</div>';
        }

        return filtered.map(t => {
            let liveTime = '';
            try {
                liveTime = new Intl.DateTimeFormat('en-US', { timeZone: t.id, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date());
            } catch (e) { liveTime = ''; }

            const isSel = (t.id === selectedTz);
            return `
                <div class="tz-list-item${isSel ? ' selected' : ''}" data-tz="${escapeHtml(t.id)}">
                    <div>
                        <div style="font-weight:600; display:flex; align-items:center; gap:6px;">
                            <span>${t.flag}</span>
                            <span>${escapeHtml(t.label)}</span>
                        </div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                            ${escapeHtml(t.id)} · <strong style="color:var(--text-secondary);">${escapeHtml(t.offset)}</strong>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.88rem; font-weight:700; color:var(--text); font-variant-numeric:tabular-nums;">${liveTime}</span>
                        ${isSel ? '<span style="display:block; font-size:0.7rem; color:var(--primary); font-weight:700;">ACTIVE</span>' : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    overlay.innerHTML = `
        <div class="tz-modal-box">
            <h3 style="margin:0 0 6px; font-size:1.1rem; color:var(--text); font-weight:700;">Organization Timezone</h3>
            <p style="margin:0 0 12px; font-size:0.84rem; color:var(--text-muted);">
                Select your primary operating timezone. Attendance logs, workday closing, and late cutoffs will use this reference.
            </p>
            <input 
                type="text" 
                id="tz-search-input" 
                placeholder="Search city, country, or GMT offset..." 
                style="width:100%; padding:9px 12px; border-radius:var(--radius); border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:0.86rem; box-sizing:border-box;"
            />
            <div id="tz-list" class="tz-list-container">
                ${renderList()}
            </div>
            <div class="dialog-actions">
                <button type="button" class="admin-btn secondary" id="tz-cancel-btn">Cancel</button>
                <button type="button" class="admin-btn primary" id="tz-save-btn">Save Timezone</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const searchInput = overlay.querySelector('#tz-search-input');
    const listEl = overlay.querySelector('#tz-list');
    const cancelBtn = overlay.querySelector('#tz-cancel-btn');
    const saveBtn = overlay.querySelector('#tz-save-btn');

    function bindItemClicks() {
        listEl.querySelectorAll('.tz-list-item').forEach(item => {
            item.addEventListener('click', () => {
                selectedTz = item.getAttribute('data-tz');
                listEl.querySelectorAll('.tz-list-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
            });
        });
    }
    bindItemClicks();

    searchInput.addEventListener('input', () => {
        listEl.innerHTML = renderList(searchInput.value);
        bindItemClicks();
    });

    cancelBtn.addEventListener('click', () => overlay.remove());

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
            const res = await callBackend({ mode: 'update-config', key: 'TIMEZONE', value: selectedTz });
            if (res && res.ok) {
                tenantTimezone = selectedTz;
                const tzEl = document.getElementById('config-timezone-current');
                if (tzEl) tzEl.textContent = formatTimezoneLabel(selectedTz);
                showToast(`Timezone updated to ${formatTimezoneLabel(selectedTz)}!`, 'success');
                overlay.remove();
            } else {
                showToast(res?.message || 'Failed to update timezone.', 'error');
            }
        } catch (e) {
            showToast('Server error updating timezone.', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Timezone';
        }
    });

    setTimeout(() => searchInput.focus(), 100);
}

function openTimePickerModal({ title, subtitle, currentMinutes, mode = 'start', onSave }) {
    let minutes = Number(currentMinutes) || (mode === 'start' ? 510 : 1020);
    let { hh12, mm, ampm } = minutesToTimeComponents(minutes);

    const startPresets = [
        { label: '8:00 AM', minutes: 480 },
        { label: '8:30 AM', minutes: 510 },
        { label: '9:00 AM', minutes: 540 },
        { label: '9:30 AM', minutes: 570 },
        { label: '10:00 AM', minutes: 600 }
    ];

    const closePresets = [
        { label: '4:30 PM', minutes: 990 },
        { label: '5:00 PM', minutes: 1020 },
        { label: '5:30 PM', minutes: 1050 },
        { label: '6:00 PM', minutes: 1080 },
        { label: '6:30 PM', minutes: 1110 },
        { label: '7:00 PM', minutes: 1140 }
    ];

    const presets = mode === 'start' ? startPresets : closePresets;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    function getFormattedTime() {
        return `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}`;
    }

    function getHelperText() {
        const timeStr = getFormattedTime();
        if (mode === 'start') {
            return `Employees clocking in at or after <strong>${timeStr}</strong> will be flagged as Late.`;
        } else {
            return `Staff who checked in on-site can sign out remotely after <strong>${timeStr}</strong> without office GPS.`;
        }
    }

    function renderPresetPills() {
        const curMin = timeComponentsToMinutes(hh12, mm, ampm);
        return presets.map(p => `
            <button type="button" class="time-preset-pill${curMin === p.minutes ? ' active' : ''}" data-min="${p.minutes}">
                ${p.label}
            </button>
        `).join('');
    }

    function renderHoursOptions() {
        let opts = '';
        for (let h = 1; h <= 12; h++) {
            opts += `<option value="${h}" ${h === hh12 ? 'selected' : ''}>${String(h).padStart(2, '0')}</option>`;
        }
        return opts;
    }

    function renderMinuteOptions() {
        const standardMinutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
        if (!standardMinutes.includes(mm)) standardMinutes.push(mm);
        standardMinutes.sort((a, b) => a - b);
        return standardMinutes.map(m => `
            <option value="${m}" ${m === mm ? 'selected' : ''}>${String(m).padStart(2, '0')}</option>
        `).join('');
    }

    overlay.innerHTML = `
        <div class="time-picker-box">
            <h3 style="margin:0 0 4px; font-size:1.15rem; color:var(--text); font-weight:700;">${escapeHtml(title)}</h3>
            ${subtitle ? `<p style="margin:0 0 10px; font-size:0.84rem; color:var(--text-muted);">${escapeHtml(subtitle)}</p>` : ''}

            <!-- Large Digital Clock Display -->
            <div class="time-display-hero">
                <span id="tp-hero-time">${getFormattedTime()}</span>
            </div>
            <div id="tp-hero-desc" style="font-size:0.82rem; color:var(--text-muted); margin-bottom:14px; min-height:36px; line-height:1.4;">
                ${getHelperText()}
            </div>

            <!-- Quick Presets -->
            <div style="font-size:0.74rem; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted); margin-bottom:6px;">
                Quick Presets
            </div>
            <div id="tp-presets-container" class="time-picker-presets">
                ${renderPresetPills()}
            </div>

            <!-- Hour / Minute / AM-PM Steppers -->
            <div class="time-stepper-row">
                <select id="tp-hour-select" class="time-select-pill">
                    ${renderHoursOptions()}
                </select>
                <span style="font-size:1.4rem; font-weight:700; color:var(--text);">:</span>
                <select id="tp-minute-select" class="time-select-pill">
                    ${renderMinuteOptions()}
                </select>
                <div class="time-period-group">
                    <button type="button" id="tp-am-btn" class="time-period-btn${ampm === 'AM' ? ' active' : ''}">AM</button>
                    <button type="button" id="tp-pm-btn" class="time-period-btn${ampm === 'PM' ? ' active' : ''}">PM</button>
                </div>
            </div>

            <!-- Quick +/- Step Adjusters -->
            <div class="time-step-btns">
                <button type="button" class="time-step-btn" data-step="-15">-15 min</button>
                <button type="button" class="time-step-btn" data-step="-5">-5 min</button>
                <button type="button" class="time-step-btn" data-step="+5">+5 min</button>
                <button type="button" class="time-step-btn" data-step="+15">+15 min</button>
            </div>

            <div class="dialog-actions">
                <button type="button" class="admin-btn secondary" id="tp-cancel-btn">Cancel</button>
                <button type="button" class="admin-btn primary" id="tp-save-btn">Update Time</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const heroTime = overlay.querySelector('#tp-hero-time');
    const heroDesc = overlay.querySelector('#tp-hero-desc');
    const presetsBox = overlay.querySelector('#tp-presets-container');
    const hourSelect = overlay.querySelector('#tp-hour-select');
    const minuteSelect = overlay.querySelector('#tp-minute-select');
    const amBtn = overlay.querySelector('#tp-am-btn');
    const pmBtn = overlay.querySelector('#tp-pm-btn');

    function syncUI() {
        heroTime.textContent = getFormattedTime();
        heroDesc.innerHTML = getHelperText();
        presetsBox.innerHTML = renderPresetPills();
        bindPresetClicks();
        hourSelect.value = String(hh12);
        minuteSelect.innerHTML = renderMinuteOptions();
        minuteSelect.value = String(mm);
        if (ampm === 'AM') {
            amBtn.classList.add('active');
            pmBtn.classList.remove('active');
        } else {
            pmBtn.classList.add('active');
            amBtn.classList.remove('active');
        }
    }

    function bindPresetClicks() {
        presetsBox.querySelectorAll('.time-preset-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetMin = Number(btn.getAttribute('data-min'));
                const comps = minutesToTimeComponents(targetMin);
                hh12 = comps.hh12;
                mm = comps.mm;
                ampm = comps.ampm;
                syncUI();
            });
        });
    }
    bindPresetClicks();

    hourSelect.addEventListener('change', () => {
        hh12 = Number(hourSelect.value);
        syncUI();
    });

    minuteSelect.addEventListener('change', () => {
        mm = Number(minuteSelect.value);
        syncUI();
    });

    amBtn.addEventListener('click', () => {
        ampm = 'AM';
        syncUI();
    });

    pmBtn.addEventListener('click', () => {
        ampm = 'PM';
        syncUI();
    });

    overlay.querySelectorAll('.time-step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const step = Number(btn.getAttribute('data-step'));
            let curMin = timeComponentsToMinutes(hh12, mm, ampm);
            curMin = (curMin + step + 1440) % 1440;
            const comps = minutesToTimeComponents(curMin);
            hh12 = comps.hh12;
            mm = comps.mm;
            ampm = comps.ampm;
            syncUI();
        });
    });

    overlay.querySelector('#tp-cancel-btn').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#tp-save-btn').addEventListener('click', async () => {
        const finalMin = timeComponentsToMinutes(hh12, mm, ampm);
        overlay.remove();
        if (typeof onSave === 'function') {
            await onSave(finalMin);
        }
    });
}

function getMondayFromDate(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.getFullYear(), d.getMonth(), diff);
}

function navigateWeek(direction) {
    if (!currentWeekStart) {
        const today = new Date();
        currentWeekStart = getMondayFromDate(today);
    } else {
        const parsed = parseDmyDate(currentWeekStart);
        if (direction === 'prev') parsed.setDate(parsed.getDate() - 7);
        else parsed.setDate(parsed.getDate() + 7);
        currentWeekStart = parsed;
    }
    currentWeekStart = formatDateDMY(currentWeekStart);
    loadWeekData();
}

function parseDmyDate(str) {
    const parts = String(str || '').split('/').map(p => p.trim());
    if (parts.length === 3) {
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
    return null;
}

function isoDateToDdMmYyyy(isoStr) {
    if (!isoStr) return '';
    const parts = isoStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return isoStr;
}

function normalizeDateKey(value) {
    if (!value) return '';
    if (value instanceof Date && !isNaN(value)) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed)) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return '';
}

function buildScheduleNameIndex(schedule) {
    const index = {};
    if (!schedule || typeof schedule !== 'object') return index;
    Object.keys(schedule).forEach((raw) => {
        const key = String(raw || '').trim().toLowerCase();
        if (key) index[key] = raw;
    });
    return index;
}

/* ---------- Tab Navigation ---------- */

function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const activeContent = document.getElementById(`tab-${tabId}`);
    if (activeContent) activeContent.classList.add('active');
    
    if (tabId === 'dashboard') { loadWeekData(); startAutoRefresh(); }
    else if (tabId === 'staff') loadStaffList();
    else if (tabId === 'logs') loadLogsViewer();
    else if (tabId === 'analytics') loadAnalytics();
    else if (tabId === 'config') loadConfigValues();
    else { clearAutoRefresh(); }
    
    resetInactivityTimer();
}

async function loadConfigValues() {
    clearAutoRefresh();
    try {
        const res = await callBackend({ mode: 'get-config' });
        if (res && res.ok && res.config) {
            const cfg = res.config;
            const latEl = document.getElementById('config-lat-current');
            const lonEl = document.getElementById('config-lon-current');
            const radiusEl = document.getElementById('config-radius-current');
            const cutoffEl = document.getElementById('config-late-cutoff-current');

            const officeLat = cfg.OFFICE_LAT !== undefined ? cfg.OFFICE_LAT : cfg.officeLat;
            const officeLon = cfg.OFFICE_LON !== undefined ? cfg.OFFICE_LON : cfg.officeLon;
            const radiusMeters = cfg.RADIUS_METERS !== undefined ? cfg.RADIUS_METERS : cfg.radiusMeters;
            const lateCutoffMinutes = cfg.LATE_CUTOFF_MINUTES !== undefined ? cfg.LATE_CUTOFF_MINUTES : cfg.lateCutoffMinutes;
            const workDays = cfg.WORK_DAYS !== undefined ? cfg.WORK_DAYS : cfg.workDays;

            if (latEl && officeLat !== undefined) latEl.textContent = officeLat;
            if (lonEl && officeLon !== undefined) lonEl.textContent = officeLon;
            if (radiusEl && radiusMeters !== undefined) radiusEl.textContent = radiusMeters + ' meters';
            if (cutoffEl && lateCutoffMinutes !== undefined) cutoffEl.textContent = formatMinutesAsTime(lateCutoffMinutes);

            if (workDays !== undefined) {
                const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                const parts = String(workDays).split('_').map(Number);
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    const labelEl = document.getElementById('config-workdays-current');
                    if (labelEl) labelEl.textContent = `${dayNames[parts[0]]} – ${dayNames[parts[1]]}`;
                }
            }

            const leadPriority = cfg.TEAM_LEAD_PRIORITY_SORT !== undefined ? cfg.TEAM_LEAD_PRIORITY_SORT : true;
            const leadPriorityEl = document.getElementById('config-lead-priority-current');
            if (leadPriorityEl) {
                const isEnabled = leadPriority === 'true' || leadPriority === true;
                leadPriorityEl.textContent = isEnabled ? 'Enabled' : 'Disabled';
            }

            const closingEl = document.getElementById('config-closing-time-current');
            const closingTimeMinutes = cfg.WORKDAY_END_MINUTES !== undefined ? Number(cfg.WORKDAY_END_MINUTES) : (cfg.CLOSING_TIME_MINUTES !== undefined ? Number(cfg.CLOSING_TIME_MINUTES) : 1020);
            tenantLateCutoffMinutes = lateCutoffMinutes !== undefined ? Number(lateCutoffMinutes) : 510;
            tenantClosingMinutes = closingTimeMinutes;
            tenantTimezone = cfg.TIMEZONE || cfg.timezone || 'Africa/Lagos';

            if (closingEl) closingEl.textContent = formatMinutesAsTime(closingTimeMinutes);

            const tzEl = document.getElementById('config-timezone-current');
            if (tzEl) tzEl.textContent = formatTimezoneLabel(tenantTimezone);

            const wfhQuotaEl = document.getElementById('config-wfh-quota-current');
            const countWfhQuota = cfg.COUNT_WFH_IN_ATTENDANCE_QUOTA !== undefined ? cfg.COUNT_WFH_IN_ATTENDANCE_QUOTA : true;
            tenantWfhQuotaEnabled = (countWfhQuota === true || countWfhQuota === 'true');
            if (wfhQuotaEl) {
                wfhQuotaEl.textContent = tenantWfhQuotaEnabled ? 'Counted in Quota' : 'Office Only';
            }
        }
    } catch (e) {
        console.warn('Could not fetch backend config:', e);
    }
}

function maskEmail(email) {
    if (!email || typeof email !== 'string' || !email.includes('@')) return 'Not configured';
    const parts = email.split('@');
    const user = parts[0];
    const domain = parts[1];
    const maskedUser = user.length <= 2 ? user[0] + '***' : user[0] + '***' + user[user.length - 1];
    const maskedDomain = domain.length <= 4 ? domain : domain[0] + '***' + domain.slice(domain.lastIndexOf('.'));
    return `${maskedUser}@${maskedDomain}`;
}

async function loadRecoveryEmailDisplay() {
    const el = document.getElementById('recovery-email-display');
    if (!el) return;
    try {
        const res = await callBackend({ mode: 'get-recovery-email' });
        if (res && res.ok && res.email) {
            el.textContent = `Active: ${maskEmail(res.email)}`;
        } else {
            el.textContent = 'Not configured';
        }
    } catch (e) {
        el.textContent = 'Active: (Configured)';
    }
}

async function loadAdminUsersList() {
    const section = document.getElementById('admin-user-management-section');
    const container = document.getElementById('admin-users-list');
    if (!container) return;

    const isSuper = safeSession.getItem('is_superuser') === 'true';
    const roleTier = safeSession.getItem('admin_role_tier') || (isSuper ? 'developer' : 'admin');

    // Sub-admins and Team Leads cannot manage other admins
    if (roleTier === 'sub_admin' || roleTier === 'team_lead') {
        if (section) section.style.display = 'none';
        return;
    }

    try {
        const res = await callBackend({ mode: 'list-admin-users' });
        let users = (res && res.ok && Array.isArray(res.users)) ? res.users : [];

        if (!users.length) {
            users = [
                { username: currentAdminUsername || 'admin', role: isSuper ? 'developer' : 'admin' }
            ];
        }

        const roleLabels = {
            developer: 'Developer',
            admin: 'Administrator',
            sub_admin: 'Sub-Admin',
            team_lead: 'Team Lead'
        };

        const rowsHtml = users.map(u => {
            // Hide developer superuser row from non-developer admins
            if (u.role === 'developer' && !isSuper) return '';
            
            const rawUser = u.username || u.name || u.email || 'Admin';
            const displayName = rawUser.includes('@') ? rawUser.split('@')[0] : rawUser;
            const isSelf = rawUser === currentAdminUsername || displayName === currentAdminUsername;
            const isDevAccount = u.role === 'developer';
            const canManage = !isSelf && (isSuper || !isDevAccount);
            const roleColors = {
                developer: 'var(--primary)',
                admin: '#6366f1',
                sub_admin: '#f59e0b',
                team_lead: '#10b981'
            };
            const roleColor = roleColors[u.role] || 'var(--text-muted)';

            return `
                <div class="admin-user-card" data-username="${escapeHtml(u.username)}">
                    <div class="admin-user-card-info">
                        <div class="admin-user-card-name">
                            <span class="admin-user-avatar">${escapeHtml(displayName.charAt(0).toUpperCase())}</span>
                            <div>
                                <div style="font-weight:700; font-size:0.95rem; color:var(--text);">${escapeHtml(displayName)}${isSelf ? ' <span style="font-size:0.72rem; color:var(--primary); font-weight:600;">(You)</span>' : ''}</div>
                                ${u.email ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:1px;">${escapeHtml(u.email)}</div>` : ''}
                            </div>
                        </div>
                        <span class="admin-role-badge" style="background:${roleColor}22; color:${roleColor}; border:1px solid ${roleColor}44;">${roleLabels[u.role] || u.role}</span>
                    </div>
                    ${canManage ? `
                        <div class="admin-user-card-actions">
                            <button class="admin-btn secondary small" type="button" data-edit-admin-role="${escapeHtml(u.username)}" data-current-role="${escapeHtml(u.role)}" title="Edit Admin"><i data-lucide="edit-2" size="12"></i> Edit</button>
                            <button class="admin-btn secondary small" type="button" data-reset-admin-pw="${escapeHtml(u.username)}" title="Reset Password"><i data-lucide="key" size="12"></i> Reset PW</button>
                            <button class="admin-btn secondary small danger" type="button" data-remove-admin="${escapeHtml(u.username)}" title="Remove Admin"><i data-lucide="trash-2" size="12"></i> Remove</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        container.innerHTML = rowsHtml || '<div class="staff-list-state">No delegated admin users.</div>';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        // Inject card styles if not already present
        if (!document.getElementById('admin-user-card-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'admin-user-card-styles';
            styleEl.textContent = `
                .admin-user-card {
                    background: var(--surface-2, #1e2130);
                    border: 1px solid var(--border, rgba(255,255,255,0.08));
                    border-radius: 12px;
                    padding: 14px 16px;
                    margin-bottom: 10px;
                    transition: box-shadow 0.18s, border-color 0.18s;
                }
                .admin-user-card:hover {
                    box-shadow: 0 4px 18px rgba(0,0,0,0.18);
                    border-color: var(--primary, #818cf8)44;
                }
                .admin-user-card-info {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                .admin-user-card-name {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .admin-user-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, var(--primary, #818cf8), #6366f1);
                    color: #fff;
                    font-weight: 700;
                    font-size: 1rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .admin-role-badge {
                    font-size: 0.72rem;
                    font-weight: 700;
                    padding: 3px 10px;
                    border-radius: 20px;
                    white-space: nowrap;
                    letter-spacing: 0.03em;
                }
                .admin-user-card-actions {
                    display: flex;
                    gap: 6px;
                    margin-top: 12px;
                    flex-wrap: wrap;
                }
            `;
            document.head.appendChild(styleEl);
        }

        // Bind remove buttons
        container.querySelectorAll('[data-remove-admin]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const target = btn.getAttribute('data-remove-admin');
                const confirmed = await confirmDialog(`Remove admin privileges for "${target}"? This cannot be undone.`, { danger: true, confirmLabel: 'Remove' });
                if (confirmed) {
                    const res = await callBackend({ mode: 'remove-admin-user', targetUsername: target });
                    showToast(res.message || 'Admin user removed.', res.ok ? 'success' : 'error');
                    if (res.ok) loadAdminUsersList();
                }
            });
        });

        // Bind edit role buttons
        container.querySelectorAll('[data-edit-admin-role]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const target = btn.getAttribute('data-edit-admin-role');
                const u = users.find(x => x.username === target || x.username === target) || {};
                const roleOptions = [
                    { value: 'admin', label: 'Administrator' },
                    { value: 'sub_admin', label: 'Sub-Admin' },
                    { value: 'team_lead', label: 'Team Lead' }
                ];
                if (isSuper) {
                    roleOptions.unshift({ value: 'developer', label: 'Developer (Superuser)' });
                }
                const fields = [
                    { label: 'Username', placeholder: 'Username', value: u.username || target },
                    { label: 'Email', type: 'email', placeholder: 'Email address', value: u.email || '' },
                    { label: 'New Password', type: 'password', placeholder: 'Leave blank to keep current', optional: true },
                    { label: 'Role Tier', type: 'select', value: u.role, options: roleOptions }
                ];
                const result = await showInlineDialog({
                    title: `Edit Admin: ${target}`,
                    message: 'Update fields below. Leave password blank to keep existing.',
                    fields,
                    confirmLabel: 'Save Changes'
                });
                if (!result) return;
                const [newUsername, email, password, newRole] = result;
                const res = await callBackend({
                    mode: 'update-admin-user',
                    targetUsername: target,
                    newUsername: newUsername || target,
                    email,
                    password: password || '',
                    tier: newRole
                });
                showToast(res.message, res.ok ? 'success' : 'error');
                if (res.ok) loadAdminUsersList();
            });
        });

        // Bind reset password buttons
        container.querySelectorAll('[data-reset-admin-pw]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const target = btn.getAttribute('data-reset-admin-pw');
                const result = await showInlineDialog({
                    title: `Reset Password: ${target}`,
                    message: 'Enter a new password for this admin user.',
                    fields: [
                        { label: 'New Password', placeholder: 'New password', type: 'password', autocomplete: 'new-password' },
                        { label: 'Confirm Password', placeholder: 'Confirm password', type: 'password', autocomplete: 'new-password' }
                    ],
                    confirmLabel: 'Reset Password'
                });
                if (!result) return;
                if (result[0] !== result[1]) {
                    showToast('Passwords do not match.', 'error');
                    return;
                }
                // Send plain-text password — Auth hashes it internally
                const res = await callBackend({ mode: 'admin-reset-user-password', targetUsername: target, newPassword: result[0] });
                showToast(res.message || 'Password reset successfully.', res.ok ? 'success' : 'error');
            });
        });
    } catch (e) {
        container.innerHTML = '<div class="staff-list-state">Default Super Admin configured.</div>';
    }
}

async function handleAddAdminUser() {
    const isSuper = safeSession.getItem('is_superuser') === 'true';
    const currentTier = safeSession.getItem('admin_role_tier') || 'admin';
    
    const options = [];
    if (currentTier === 'developer' || currentTier === 'admin' || currentTier === 'sub_admin' || currentTier === 'team_lead') {
        options.push({ value: 'team_lead', label: 'Team Lead' });
    }
    if (currentTier === 'developer' || currentTier === 'admin' || currentTier === 'sub_admin') {
        options.unshift({ value: 'sub_admin', label: 'Sub-Admin' });
    }
    if (currentTier === 'developer' || currentTier === 'admin') {
        options.unshift({ value: 'admin', label: 'Super Admin' });
    }
    if (currentTier === 'developer') {
        options.unshift({ value: 'developer', label: 'Developer (Superuser)' });
    }

    const fields = [
        { placeholder: 'Username' },
        { placeholder: 'Email Address', type: 'email' },
        { placeholder: 'Password', type: 'password', autocomplete: 'new-password' },
        { placeholder: 'Role Tier', type: 'select', options: options }
    ];

    const result = await showInlineDialog({
        title: 'Add Admin User',
        fields,
        confirmLabel: 'Create'
    });

    if (!result || !result[0] || !result[1] || !result[2]) return;
    const newUsername = result[0].trim();
    const email = result[1].trim();
    const newPass = result[2];
    const selectedRole = result[3] || (isSuper ? 'admin' : 'sub_admin');

    const res = await callBackend({
        mode: 'add-admin-user',
        newUsername,
        email,
        password: newPass,
        role: selectedRole
    });

    showToast(res.message || 'Admin user created successfully!', res.ok ? 'success' : 'error');
    if (res.ok) loadAdminUsersList();
}

/* ---------- Export Functions ---------- */

function exportToCSV(data, filename) {
    if (!data || !data.length) { showToast('No data to export.', 'error'); return; }
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','),
        ...data.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
    ];
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`Exported ${data.length} records.`, 'success');
}

function isStaffIncludedInReports(name) {
    const lower = String(name || '').trim().toLowerCase();
    if (!lower) return false;
    const staffMember = (allStaffList || []).find(s => String(s.name || '').trim().toLowerCase() === lower);
    if (staffMember) {
        if (staffMember.include_in_reports === false) return false;
        if (staffMember.schedule_policy === 'field_flexible' || staffMember.schedule_policy === 'executive') return false;
        return true;
    }
    // Backward compatibility fallback for legacy or unlisted names
    if (lower.includes('kenneth') || lower.includes('valentine') || lower === 'uche') {
        return false;
    }
    return true;
}

function exportStaffRosterCSV() {
    if (!allStaffList || !allStaffList.length) {
        showToast('No staff records found to export.', 'error');
        return;
    }
    const rows = allStaffList.map(s => ({
        'Staff Name': s.name,
        'Department': s.dept || 'General',
        'Work Policy': s.schedule_policy || 'weekly_hybrid',
        'Team Lead': s.is_team_lead ? 'Yes' : 'No',
        'Include In Reports': s.include_in_reports !== false ? 'Yes' : 'No',
        'Device Status': (s.device_id || s.deviceId) ? 'Linked' : 'Unlinked',
        'Device ID': s.device_id || s.deviceId || 'None'
    }));
    const tenantSlug = currentTenantConfig ? currentTenantConfig.slug : 'workspace';
    exportToCSV(rows, `${tenantSlug}_staff_roster`);
}

function exportFilteredLogsCSV() {
    const list = logsAllRecords && logsAllRecords.length ? logsAllRecords : [];
    if (!list.length) {
        showToast('No attendance logs found to export.', 'error');
        return;
    }
    const rows = list.map(l => ({
        'Staff Name': l.name,
        'Action': l.action,
        'Date': l.date || (l.created_at ? l.created_at.split('T')[0] : ''),
        'Time': l.time || (l.created_at ? new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''),
        'Status': l.status || 'Verified',
        'Distance (meters)': l.distance !== undefined ? Math.round(l.distance) : '',
        'Recorded At (UTC)': l.created_at || ''
    }));
    const tenantSlug = currentTenantConfig ? currentTenantConfig.slug : 'workspace';
    exportToCSV(rows, `${tenantSlug}_attendance_logs`);
}

async function exportFullTenantArchive() {
    try {
        const tenant = currentTenantConfig || await getActiveTenant();
        const tenantSlug = tenant ? tenant.slug : 'lifecard';
        const config = await getTenantConfig(tenantSlug);
        let logQuery = supabaseClient ? supabaseClient.from('attendance').select('*') : null;
        if (logQuery) {
            if (tenantSlug === 'lifecard') {
                logQuery = logQuery.or('tenant_slug.eq.lifecard,tenant_slug.is.null');
            } else {
                logQuery = logQuery.eq('tenant_slug', tenantSlug);
            }
        }
        const { data: logs } = logQuery ? await logQuery.limit(500) : { data: [] };

        const archiveObj = {
            version: '3.0.0',
            exported_at: new Date().toISOString(),
            tenant,
            config,
            staff,
            logs_sample: logs || []
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(archiveObj, null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `${tenantSlug}_full_workspace_archive.json`;
        a.click();
        showToast('Full workspace archive downloaded.', 'success');
    } catch(err) {
        console.error('Archive export failed:', err);
        showToast('Failed to export workspace archive.', 'error');
    }
}

function requestWorkspaceDeletion() {
    const tenant = currentTenantConfig;
    const name = tenant ? tenant.name : 'this company';
    const slug = tenant ? tenant.slug : '';

    // "Are You Sure?" Cancellation Retention Modal (Rule 3: Retains ~4x more users with an exclusive deal)
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
        <div class="dialog-box" style="max-width: 480px; width: 92vw; text-align: center; padding: 28px 24px;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(220, 38, 38, 0.1); color: var(--danger); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto;">
                <i data-lucide="shield-alert" size="24"></i>
            </div>
            <h3 style="margin-bottom: 8px; font-size: 1.25rem;">Before you go...</h3>
            <p style="color: var(--text-muted); font-size: 0.88rem; line-height: 1.5; margin-bottom: 18px;">
                We'd love to keep supporting <strong>${escapeHtml(name)}</strong>'s hybrid & office team. To make your journey smoother, we've unlocked a special loyalty partner deal for your account:
            </p>
            
            <div style="background: rgba(26, 86, 219, 0.08); border: 1px dashed var(--primary); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 20px;">
                <div style="font-size: 1.15rem; font-weight: 800; color: var(--primary); margin-bottom: 2px;">
                    50% OFF for the Next 3 Months
                </div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">
                    Keep all your geofenced attendance logs, hybrid scheduling, and biometric authentication active.
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button id="retention-deal-accept-btn" class="admin-btn" type="button" style="width: 100%; justify-content: center; padding: 10px;">
                    <i data-lucide="tag" size="14"></i> Claim 50% Off &amp; Keep Workspace
                </button>
                <button id="retention-deal-cancel-btn" class="admin-btn secondary danger" type="button" style="width: 100%; justify-content: center; font-size: 0.82rem;">
                    Continue with Deletion Request
                </button>
                <button id="retention-modal-dismiss-btn" class="admin-btn secondary" type="button" style="width: 100%; justify-content: center; font-size: 0.82rem;">
                    Never Mind, Stay on Current Plan
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();

    overlay.querySelector('#retention-deal-accept-btn').addEventListener('click', async () => {
        overlay.remove();
        showToast('Special 50% loyalty discount applied to your next 3 billing cycles!', 'success', 6000);
        try {
            await callBackend({
                mode: 'apply-retention-deal',
                slug: slug,
                discount_percent: 50,
                duration_months: 3
            });
        } catch (e) {
            console.warn('Retention deal record ping:', e);
        }
    });

    overlay.querySelector('#retention-modal-dismiss-btn').addEventListener('click', () => {
        overlay.remove();
    });

    overlay.querySelector('#retention-deal-cancel-btn').addEventListener('click', () => {
        overlay.remove();
        const subject = encodeURIComponent(`Workspace Deletion & Data Purge Request: ${name} (${slug})`);
        const body = encodeURIComponent(`Hello Platform Operations Team,\n\nI am requesting complete account decommissioning, tenant deletion, and database purging for:\n\nCompany: ${name}\nWorkspace Slug: ${slug}\nRequested By: ${currentAdminUsername}\nDate: ${new Date().toISOString()}\n\nPlease confirm when deletion is scheduled.\n\nThank you.`);
        window.location.href = `mailto:support@lifecard.local?subject=${subject}&body=${body}`;
    });
}

function printWeeklyAttendanceReport() {
    const matrixEl = document.getElementById('attendance-matrix');
    const weekLabel = document.getElementById('week-label')?.textContent || 'Current Week';
    const tenantName = currentTenantConfig?.name || 'Company';

    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (!printWin) {
        showToast('Please allow popups to generate printable report.', 'error');
        return;
    }

    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Attendance Summary Report - ${tenantName} - ${weekLabel}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1e293b; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 14px; margin-bottom: 20px; }
                h1 { font-size: 1.4rem; margin: 0; color: #0f172a; }
                .meta { font-size: 0.85rem; color: #64748b; }
                table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 0.85rem; }
                th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
                th { background: #f1f5f9; font-weight: 600; }
                .footer { margin-top: 30px; font-size: 0.75rem; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>${escapeHtml(tenantName)} - Attendance Summary</h1>
                    <div class="meta">${escapeHtml(weekLabel)} &bull; Generated on ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
                </div>
                <div style="font-weight:700; color:#1a56db; font-size:1.1rem;">Verified Roster</div>
            </div>
            ${matrixEl ? matrixEl.innerHTML : '<p>No attendance matrix data available.</p>'}
            <div class="footer">
                Attendance Cloud Enterprise Verification Engine &bull; Confidential Internal HR Document
            </div>
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `);
    printWin.document.close();
}

function exportWeekMatrixToCSV(logs, schedule, weekStartStr) {
    const monday = parseDmyDate(weekStartStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedHumanDate = `${monday.getDate()}_${months[monday.getMonth()]}_${monday.getFullYear()}`;
    const fileName = `Attendance Report-Week Starting-${formattedHumanDate}`;
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const weekDays = [];
    for (let i = 0; i < 5; i++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        weekDays.push(formatDateDMY(day));
    }

    const allStaff = new Set();
    Object.keys(schedule || {}).forEach(name => allStaff.add(name));
    (logs || []).forEach(entry => allStaff.add(entry.name));
    if (allStaffList.length) allStaffList.forEach(s => allStaff.add(s.name));
    const sortedStaff = Array.from(allStaff).sort((a, b) => a.localeCompare(b));
    const filteredStaff = sortedStaff.filter(name => isStaffIncludedInReports(name));

    if (!filteredStaff.length) { showToast('No staff data to export for this week.', 'error'); return; }

    const scheduleNameIndex = buildScheduleNameIndex(schedule);

    const rows = filteredStaff.map(name => {
        const normalizedStaffName = String(name || '').trim().toLowerCase();
        const row = { Staff: name };

        let presentCount = 0;
        let lateCount = 0;
        let wfhCount = 0;
        let leaveCount = 0;
        let missedCount = 0;

        weekDays.forEach((day, idx) => {
            const columnLabel = `${dayNames[idx]} ${day}`;
            const dayKey = normalizeDateKey(day);

            const dayLogs = (logs || []).filter(l => {
                const logName = String(l.name || '').trim().toLowerCase();
                const logDateKey = normalizeDateKey(l.date || l.timestamp || '');
                return logName === normalizedStaffName && logDateKey === dayKey;
            });

            let scheduleKey = scheduleNameIndex[normalizedStaffName] || null;
            if (!scheduleKey) {
                const candidate = Object.keys(schedule || {}).find(k => {
                    const nk = String(k || '').trim().toLowerCase();
                    return nk === normalizedStaffName || nk.includes(normalizedStaffName) || normalizedStaffName.includes(nk);
                });
                if (candidate) scheduleKey = candidate;
            }
            const staffSchedules = scheduleKey ? (schedule[scheduleKey] || null) : null;
            const dayName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][idx];
            let locationVal = '';

            if (Array.isArray(staffSchedules)) {
                const daySched = staffSchedules.find(s => normalizeDateKey(s.date) === dayKey || String(s.day || '').toLowerCase() === dayName.toLowerCase());
                locationVal = daySched?.location || daySched?.type || '';
            } else if (typeof staffSchedules === 'object' && staffSchedules !== null) {
                const val = staffSchedules[dayName] || staffSchedules[dayName.toLowerCase()] || staffSchedules[idx];
                if (typeof val === 'string') locationVal = val;
                else if (typeof val === 'object' && val !== null) locationVal = val.location || val.type || '';
            }
            const isWfh = String(locationVal || '').trim().toLowerCase() === 'home';
            const isLeave = String(locationVal || '').trim().toLowerCase() === 'leave';
            const inLog = dayLogs.find(l => String(l.action || '').trim().toUpperCase() === 'IN');

            let cellText = '—';
            if (inLog) {
                presentCount++;
                const isLate = inLog.status && String(inLog.status).trim().toUpperCase() === 'LATE';
                if (isWfh) {
                    wfhCount++;
                    cellText = `Home (${inLog.time || 'Present'})`;
                } else {
                    cellText = inLog.time || 'Present';
                }
                if (isLate) {
                    lateCount++;
                    cellText += ' (Late)';
                }
            } else if (isLeave) {
                leaveCount++;
                cellText = 'Leave';
            } else if (isWfh) {
                wfhCount++;
                cellText = 'Home';
            } else {
                missedCount++;
                cellText = 'Missed';
            }

            row[columnLabel] = cellText;
        });

        row['Days Present'] = presentCount;
        row['Days Late'] = lateCount;
        row['Days Home'] = wfhCount;
        row['Days on Leave'] = leaveCount;
        row['Days Missed'] = missedCount;

        return row;
    });

    exportToCSV(rows, fileName);
}

function exportWeekMatrixToPDF(logs, schedule, weekStartStr) {
    const monday = parseDmyDate(weekStartStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedHumanDate = `${monday.getDate()}_${months[monday.getMonth()]}_${monday.getFullYear()}`;
    const fileName = `Attendance Report-Week Starting-${formattedHumanDate}`;
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const weekDays = [];
    for (let i = 0; i < 5; i++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        weekDays.push(formatDateDMY(day));
    }
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const weekRangeStr = `${formatDateDMY(monday)} - ${formatDateDMY(friday)}`;

    const allStaff = new Set();
    Object.keys(schedule || {}).forEach(name => allStaff.add(name));
    (logs || []).forEach(entry => allStaff.add(entry.name));
    if (allStaffList.length) allStaffList.forEach(s => allStaff.add(s.name));
    const sortedStaff = Array.from(allStaff).sort((a, b) => a.localeCompare(b));
    const filteredStaff = sortedStaff.filter(name => isStaffIncludedInReports(name));

    if (!filteredStaff.length) { showToast('No staff data to export.', 'error'); return; }

    const scheduleNameIndex = buildScheduleNameIndex(schedule);

    let tableRowsHtml = '';
    let totalPresent = 0;
    let totalLates = 0;
    let totalWfh = 0;
    let totalLeave = 0;
    let totalMissed = 0;

    filteredStaff.forEach(name => {
        const normalizedStaffName = String(name || '').trim().toLowerCase();
        let rowCellsHtml = `<td style="padding: 8px 10px; border: 1px solid #cbd5e1; font-weight: 600; text-align: left; color: #0f172a;">${escapeHtml(name)}</td>`;
        
        let staffPresent = 0;
        let staffLate = 0;
        let staffWfh = 0;
        let staffLeave = 0;
        let staffMissed = 0;

        let scheduleKey = scheduleNameIndex[normalizedStaffName] || null;
        if (!scheduleKey) {
            const candidate = Object.keys(schedule || {}).find(k => {
                const nk = String(k || '').trim().toLowerCase();
                return nk === normalizedStaffName || nk.includes(normalizedStaffName) || normalizedStaffName.includes(nk);
            });
            if (candidate) scheduleKey = candidate;
        }
        const staffSchedules = scheduleKey ? (schedule[scheduleKey] || null) : null;

        weekDays.forEach((day, idx) => {
            const dayKey = normalizeDateKey(day);

            const dayLogs = (logs || []).filter(l => {
                const logName = String(l.name || '').trim().toLowerCase();
                const logDateKey = normalizeDateKey(l.date || l.timestamp || '');
                return logName === normalizedStaffName && logDateKey === dayKey;
            });

            const dayName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][idx];
            let locationVal = '';

            if (Array.isArray(staffSchedules)) {
                const daySched = staffSchedules.find(s => normalizeDateKey(s.date) === dayKey || String(s.day || '').toLowerCase() === dayName.toLowerCase());
                locationVal = daySched?.location || daySched?.type || '';
            } else if (typeof staffSchedules === 'object' && staffSchedules !== null) {
                const val = staffSchedules[dayName] || staffSchedules[dayName.toLowerCase()] || staffSchedules[idx];
                if (typeof val === 'string') locationVal = val;
                else if (typeof val === 'object' && val !== null) locationVal = val.location || val.type || '';
            }
            const isWfh = String(locationVal || '').trim().toLowerCase() === 'home';
            const isLeave = String(locationVal || '').trim().toLowerCase() === 'leave';
            const inLog = dayLogs.find(l => String(l.action || '').trim().toUpperCase() === 'IN');

            let cellContent = '—';
            let cellStyle = 'padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; color: #64748b;';

            if (inLog) {
                staffPresent++;
                totalPresent++;
                const isLate = inLog.status && String(inLog.status).trim().toUpperCase() === 'LATE';
                if (isWfh) {
                    staffWfh++;
                    totalWfh++;
                    if (isLate) {
                        staffLate++;
                        totalLates++;
                        cellContent = `Home: ${inLog.time || 'Present'} (Late)`;
                        cellStyle += ' background: #fdf2f2; color: #9b1c1c; font-weight: 500;';
                    } else {
                        cellContent = `Home: ${inLog.time || 'Present'}`;
                        cellStyle += ' background: #eff6ff; color: #1d4ed8; font-weight: 500;';
                    }
                } else {
                    if (isLate) {
                        staffLate++;
                        totalLates++;
                        cellContent = `Late: ${inLog.time || 'Present'}`;
                        cellStyle += ' background: #fdf2f2; color: #9b1c1c; font-weight: 500;';
                    } else {
                        cellContent = `In: ${inLog.time || 'Present'}`;
                        cellStyle += ' background: #f8fafc; color: #0f172a;';
                    }
                }
            } else if (isLeave) {
                staffLeave++;
                totalLeave++;
                cellContent = 'Leave';
                cellStyle += ' background: #f3e8ff; color: #6b21a8; font-weight: 500;';
            } else if (isWfh) {
                staffWfh++;
                totalWfh++;
                cellContent = 'Home';
                cellStyle += ' background: #f0fdf4; color: #166534; font-weight: 500;';
            } else {
                staffMissed++;
                totalMissed++;
                cellContent = 'Missed';
                cellStyle += ' background: #fffbeb; color: #854d0e;';
            }

            rowCellsHtml += `<td style="${cellStyle}">${cellContent}</td>`;
        });

        rowCellsHtml += `
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; background: #f8fafc; font-weight: bold; color: #0f172a;">${staffPresent}</td>
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; background: #fdf2f2; color: #9b1c1c; font-weight: bold;">${staffLate}</td>
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; background: #f0fdf4; color: #166534; font-weight: bold;">${staffWfh}</td>
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; background: #f3e8ff; color: #6b21a8; font-weight: bold;">${staffLeave}</td>
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; background: #fffbeb; color: #854d0e; font-weight: bold;">${staffMissed}</td>
        `;

        tableRowsHtml += `<tr style="border-bottom: 1px solid #cbd5e1;">${rowCellsHtml}</tr>`;
    });

    const totalWorkingDays = totalPresent + totalWfh + totalMissed;
    const attendedCount = tenantWfhQuotaEnabled ? (totalPresent + totalWfh) : totalPresent;
    const attendanceRate = totalWorkingDays > 0 ? Math.round((attendedCount / totalWorkingDays) * 100) : 0;
    const onTimeRate = totalPresent > 0 ? Math.round(((totalPresent - totalLates) / totalPresent) * 100) : 0;

    const printDiv = document.createElement('div');
    printDiv.id = 'print-report-container';
    printDiv.innerHTML = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 1000px; margin: 0 auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #cbd5e1; padding-bottom: 10px; margin-bottom: 20px;">
                <div>
                    <h1 style="margin: 0; font-size: 22px; color: #0f172a;">Lifecard Staff Attendance Report</h1>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">Weekly Matrix & Metrics Summary</p>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 13px; font-weight: bold; color: #0f172a; padding: 6px 12px; background: #f1f5f9; border-radius: 4px;">Week: ${weekRangeStr}</div>
                </div>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px;">
                <thead>
                    <tr style="background: #f1f5f9; border: 1px solid #cbd5e1; text-align: left;">
                        <th style="padding: 10px; border: 1px solid #cbd5e1;">Staff Name</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 11%;">Mon ${weekDays[0]}</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 11%;">Tue ${weekDays[1]}</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 11%;">Wed ${weekDays[2]}</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 11%;">Thu ${weekDays[3]}</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 11%;">Fri ${weekDays[4]}</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; background: #e2e8f0; width: 6%;">Pres</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; background: #fee2e2; color: #991b1b; width: 6%;">Late</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; background: #dcfce7; color: #166534; width: 6%;">Home</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; background: #f3e8ff; color: #6b21a8; width: 6%;">Leave</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; background: #fef9c3; color: #854d0e; width: 6%;">Miss</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>
            
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 15px; margin-top: 20px;">
                <div style="text-align: center;">
                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">Attendance Rate</div>
                    <div style="font-size: 20px; font-weight: bold; color: #0f172a;">${attendanceRate}%</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">On-Time Rate</div>
                    <div style="font-size: 20px; font-weight: bold; color: #166534;">${onTimeRate}%</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">Total Sign-Ins</div>
                    <div style="font-size: 20px; font-weight: bold; color: #0f172a;">${totalPresent} <span style="font-size: 11px; color: #94a3b8; font-weight: normal;">(${totalLates} late)</span></div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">Staff on Leave</div>
                    <div style="font-size: 20px; font-weight: bold; color: #6b21a8;">${totalLeave} days</div>
                </div>
            </div>
            
            <div style="margin-top: 30px; font-size: 9px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                Report generated on ${new Date().toLocaleString()} • Lifecard Attendance Systems
            </div>
        </div>
    `;

    const styleTag = document.createElement('style');
    styleTag.id = 'print-report-style';
    styleTag.textContent = `
        @media print {
            body > * { display: none !important; }
            #print-report-container { display: block !important; }
            #print-report-container * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
    `;

    document.body.appendChild(printDiv);
    document.body.appendChild(styleTag);
    
    const originalTheme = document.documentElement.getAttribute('data-theme') || 'light';
    document.documentElement.setAttribute('data-theme', 'light');
    const originalTitle = document.title;
    document.title = fileName;
    window.print();
    document.title = originalTitle;
    document.documentElement.setAttribute('data-theme', originalTheme);
    
    setTimeout(() => {
        printDiv.remove();
        styleTag.remove();
    }, 500);
}

async function handleExportWeek(weekData, weekStartStr) {
    const formatChoice = await showInlineDialog({
        title: 'Export Attendance Report',
        message: `Select the format to download this week's report (${weekStartStr}):`,
        fields: [
            {
                type: 'select',
                options: [
                    { label: 'Excel/CSV Spreadsheet', value: 'csv' },
                    { label: 'PDF Report', value: 'pdf' }
                ],
                value: 'csv'
            }
        ],
        confirmLabel: 'Export',
        cancelLabel: 'Cancel'
    });
    if (!formatChoice || !formatChoice[0]) return;
    const format = formatChoice[0];

    const logs = weekData.logs || [];
    const schedule = weekData.schedule || {};

    if (format === 'csv') {
        exportWeekMatrixToCSV(logs, schedule, weekStartStr);
    } else if (format === 'pdf') {
        exportWeekMatrixToPDF(logs, schedule, weekStartStr);
    }
}

/* ============================================================
   DASHBOARD / WEEK DATA
   ============================================================ */

async function loadWeekData(isSilent = false) {
    if (!currentWeekStart) {
        const today = new Date();
        currentWeekStart = formatDateDMY(getMondayFromDate(today));
    }

    const weekBeingLoaded = currentWeekStart;
    const { monday, friday } = getWeekRange(parseDmyDate(weekBeingLoaded));
    const mondayStr = formatDateDMY(monday);
    const fridayStr = formatDateDMY(friday);
    
    const weekLabel = document.getElementById('week-label');
    if (weekLabel) weekLabel.textContent = `${mondayStr} - ${fridayStr}`;

    const weekDays = [];
    for (let i = 0; i < 5; i++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        weekDays.push(formatDateDMY(day));
    }
    
    // Check in-memory & localStorage cache for 0ms instant rendering
    if (!cachedWeekData[weekBeingLoaded]) {
        try {
            const stored = safeStorage.getItem('admin_cache_week_' + weekBeingLoaded);
            if (stored) cachedWeekData[weekBeingLoaded] = JSON.parse(stored);
        } catch (e) {}
    }

    if (cachedWeekData[weekBeingLoaded]) {
        const cachedLogs = cachedWeekData[weekBeingLoaded].logs || [];
        const weekDaysNormalized = weekDays.map(wd => normalizeDateKey(wd));
        const filteredCachedLogs = cachedLogs.filter(l => {
            const logDateNormalized = normalizeDateKey(l.date || l.timestamp || '');
            return weekDaysNormalized.includes(logDateNormalized);
        });
        renderWeekOverview(filteredCachedLogs, cachedWeekData[weekBeingLoaded].schedule, weekDays);
        renderAttendanceMatrix(filteredCachedLogs, cachedWeekData[weekBeingLoaded].schedule, weekDays);
    } else if (!isSilent) {
        document.getElementById('today-attendance-list').innerHTML = `
            <div class="summary-stat-card skeleton-box skeleton-card"></div>
        `;
        document.getElementById('attendance-matrix').innerHTML = `
            <div class="skeleton-box skeleton-row"></div>
            <div class="skeleton-box skeleton-row"></div>
            <div class="skeleton-box skeleton-row"></div>
        `;
    }
    
    try {
        const response = await fetchLogs({ weekStart: weekBeingLoaded, limit: 500 });
        const rawLogs = response.ok && Array.isArray(response.logs) ? response.logs : [];
        
        // Filter logs locally to only include this week's records
        const weekDaysNormalized = weekDays.map(wd => normalizeDateKey(wd));
        const logs = rawLogs.filter(l => {
            const logDateNormalized = normalizeDateKey(l.date || l.timestamp || '');
            return weekDaysNormalized.includes(logDateNormalized);
        });

        const schedule = await fetchHybridSchedule(weekBeingLoaded, false);
        
        cachedWeekData[weekBeingLoaded] = { logs, schedule };
        try { safeStorage.setItem('admin_cache_week_' + weekBeingLoaded, JSON.stringify({ logs, schedule })); } catch (e) {}
        
        if (currentWeekStart === weekBeingLoaded) {
            renderWeekOverview(logs, schedule, weekDays);
            renderAttendanceMatrix(logs, schedule, weekDays);

            const refreshLabel = document.getElementById('refresh-label');
            if (refreshLabel) {
                const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                refreshLabel.innerHTML = `<span class="live-pulse-dot" title="30s live auto-refresh active"></span> Live (${timeStr})`;
            }
        }
        
        if (!isSilent && currentTab === 'dashboard') {
            fetchHybridSchedule(weekBeingLoaded, true).then(freshSchedule => {
                if (freshSchedule && Object.keys(freshSchedule).length) {
                    const oldSchedule = hybridScheduleCache[weekBeingLoaded];
                    if (JSON.stringify(oldSchedule) !== JSON.stringify(freshSchedule)) {
                        hybridScheduleCache[weekBeingLoaded] = freshSchedule;
                        if (cachedWeekData[weekBeingLoaded]) cachedWeekData[weekBeingLoaded].schedule = freshSchedule;

                        if (currentWeekStart === weekBeingLoaded) {
                            renderAttendanceMatrix(logs, freshSchedule, weekDays);
                            const refreshLabel = document.getElementById('refresh-label');
                            if (refreshLabel) {
                                const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                refreshLabel.innerHTML = `<span class="live-pulse-dot" title="30s live auto-refresh active"></span> Live (${timeStr})`;
                            }
                        }
                    }
                }
            }).catch(err => console.warn('Background schedule refresh failed:', err));
        }
    } catch (error) {
        console.error('Error loading week data:', error);
        if (!isSilent && currentWeekStart === weekBeingLoaded) {
            document.getElementById('today-attendance-list').innerHTML = '<div class="staff-list-state">Failed to load data. Check connection.</div>';
        }
    }
}

function renderWeekOverview(logs, schedule, weekDays) {
    const host = document.getElementById('today-attendance-list');
    if (!host) return;
    
    const safeLogs = Array.isArray(logs) ? logs : [];
    const signedIn = safeLogs.filter(s => String(s.action || '').trim().toUpperCase() === 'IN').length;
    const lateCount = safeLogs.filter(s => normalizeAttendanceStatus(s.status) === 'late' && String(s.action || '').trim().toUpperCase() === 'IN').length;
    
    setHtmlIfChanged(host, `
        <div class="today-attendance-summary">
            <div class="summary-stat-card">
                <span class="stat-number">${safeLogs.length}</span>
                <span class="stat-label">Total Actions</span>
            </div>
            <div class="summary-stat-card signed-in-bg">
                <span class="stat-number">${signedIn}</span>
                <span class="stat-label">Sign Ins</span>
            </div>
            <div class="summary-stat-card ${lateCount > 0 ? 'warning' : 'ok'}">
                <span class="stat-number">${lateCount}</span>
                <span class="stat-label">Late</span>
            </div>
        </div>
    `);
}

function renderAttendanceMatrix(logs, schedule, weekDays) {
    const host = document.getElementById('attendance-matrix');
    if (!host) return;
    
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const allStaff = new Set();
    
    Object.keys(schedule).forEach(name => allStaff.add(name));
    logs.forEach(entry => allStaff.add(entry.name));
    if (allStaffList.length) allStaffList.forEach(s => allStaff.add(s.name));
    
    const sortedStaff = Array.from(allStaff).sort((a, b) => a.localeCompare(b));
    const scheduleNameIndex = buildScheduleNameIndex(schedule);
    
    const matrix = {};
    sortedStaff.forEach(name => {
        matrix[name] = {};
        weekDays.forEach((day, idx) => {
            const dayKey = normalizeDateKey(day);
            const normalizedStaffName = String(name || '').trim().toLowerCase();

            const dayLogs = logs.filter(l => {
                const logName = String(l.name || '').trim().toLowerCase();
                const logDateKey = normalizeDateKey(l.date || l.timestamp || '');
                return logName === normalizedStaffName && logDateKey === dayKey;
            });

            let scheduleKey = scheduleNameIndex[normalizedStaffName] || null;
            if (!scheduleKey) {
                const candidate = Object.keys(schedule || {}).find(k => {
                    const nk = String(k || '').trim().toLowerCase();
                    return nk === normalizedStaffName || nk.includes(normalizedStaffName) || normalizedStaffName.includes(nk);
                });
                if (candidate) scheduleKey = candidate;
            }
            const staffSchedules = scheduleKey ? (schedule[scheduleKey] || null) : null;
            const dayName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][idx];
            let locationVal = '';

            if (Array.isArray(staffSchedules)) {
                const daySched = staffSchedules.find(s => normalizeDateKey(s.date) === dayKey || String(s.day || '').toLowerCase() === dayName.toLowerCase());
                locationVal = daySched?.location || daySched?.type || '';
            } else if (typeof staffSchedules === 'object' && staffSchedules !== null) {
                const val = staffSchedules[dayName] || staffSchedules[dayName.toLowerCase()] || staffSchedules[idx];
                if (typeof val === 'string') locationVal = val;
                else if (typeof val === 'object' && val !== null) locationVal = val.location || val.type || '';
            }

            const isWfh = String(locationVal || '').trim().toLowerCase() === 'home';
            const isLeave = String(locationVal || '').trim().toLowerCase() === 'leave';

            matrix[name][idx] = {
                logs: dayLogs,
                schedule: staffSchedules,
                isWfh: isWfh,
                isLeave: isLeave
            };
        });
    });
    
    setHtmlIfChanged(host, `
        <div class="matrix-wrapper">
            <table class="attendance-matrix">
                <thead>
                    <tr>
                        <th>Staff</th>
                        ${dayLabels.map((label, i) => `<th>${label}<br><span class="matrix-date">${weekDays[i]}</span></th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${sortedStaff.map(name => {
                        const row = matrix[name];
                        return `<tr>
                            <td class="matrix-name">${escapeHtml(name)}</td>
                            ${weekDays.map((_, i) => {
                                const cell = row[i];
                                const inLog = cell.logs.find(l => String(l.action || '').trim().toUpperCase() === 'IN');

                                let status = '';
                                let statusClass = '';

                                if (inLog) {
                                    const isLate = inLog.status && String(inLog.status).trim().toUpperCase() === 'LATE';
                                    if (cell.isWfh) {
                                        status = `🏠 Home In<br>${escapeHtml(inLog.time || '')}`;
                                        statusClass = isLate ? 'matrix-late' : 'matrix-wfh';
                                    } else {
                                        status = `📍 In<br>${escapeHtml(inLog.time || '')}`;
                                        statusClass = isLate ? 'matrix-late' : 'matrix-in';
                                    }
                                    if (isLate) status += '<br><span style="font-size:0.75rem; color:#dc2626; font-weight:700;">Late</span>';
                                } else if (cell.isLeave) {
                                    status = '<span class="matrix-leave-text" aria-label="Leave" style="font-weight:600; color:#8b5cf6;">🌴 Leave</span>';
                                    statusClass = 'matrix-leave';
                                } else if (cell.isWfh) {
                                    status = '<span class="matrix-home-text" aria-label="Home" style="font-weight:600; color:#2563eb;">🏠 Home</span>';
                                    statusClass = 'matrix-wfh';
                                } else {
                                    status = '—';
                                    statusClass = 'matrix-absent';
                                }

                                return `<td class="matrix-cell ${statusClass}">${status}</td>`;
                            }).join('')}
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="matrix-legend">
            <span class="legend-item"><span class="legend-dot matrix-in"></span> 📍 Signed In</span>
            <span class="legend-item"><span class="legend-dot matrix-late"></span> Late</span>
            <span class="legend-item"><span class="legend-dot matrix-wfh"></span> 🏠 Home</span>
            <span class="legend-item"><span class="legend-dot matrix-leave"></span> 🌴 Leave</span>
            <span class="legend-item"><span class="legend-dot matrix-absent"></span> Absent</span>
        </div>
    `);

    if (window.location && window.location.hash === '#debug-schedule') {
        try {
            const debugRows = sortedStaff.map(name => {
                const n = String(name || '').trim();
                const key = scheduleNameIndex[n.toLowerCase()] || null;
                const sched = key ? (schedule[key] || []) : [];
                const wfhCount = sched.filter(s => String(s.location || '').toLowerCase() === 'home').length;
                return { name: n, scheduleKey: key, wfhCount, sched };
            });
            const debugHtml = '<div class="analytics-section debug-schedule">' +
                '<h4><i data-lucide="terminal" size="14" style="vertical-align:middle; margin-right:4px;"></i> Schedule Debug</h4>' +
                '<pre style="max-height:240px;overflow:auto;white-space:pre-wrap">' + escapeHtml(JSON.stringify({ scheduleNameIndex, debugRows }, null, 2)) + '</pre>' +
                '</div>';
            host.innerHTML += debugHtml;
            if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        } catch (e) {
            console.warn('Schedule debug render failed', e.message);
        }
    }
}

/* ============================================================
   STAFF MANAGEMENT TAB
   ============================================================ */

function renderStaffList(staff) {
    const staffList = document.getElementById('staff-list');
    if (!staffList) return;
    if (Array.isArray(staff)) allStaffList = staff;

    const searchQuery = (document.getElementById('staff-admin-search')?.value || '').trim().toLowerCase();
    const filteredStaff = searchQuery 
        ? allStaffList.filter(s => String(s.name || '').toLowerCase().includes(searchQuery))
        : allStaffList;

    if (!filteredStaff.length) {
        staffList.innerHTML = `<div class="staff-list-state">${searchQuery ? `No staff matching "${escapeHtml(searchQuery)}"` : 'No staff members configured. Add your first staff member below.'}</div>`;
        return;
    }
    
    const headerHtml = `
        <div class="staff-header-row">
            <div>Staff Member</div>
            <div>Work Policy</div>
            <div>Device Link</div>
            <div class="staff-actions-header">Actions</div>
        </div>
    `;

    const policyLabels = {
        weekly_hybrid: { label: 'Hybrid', tooltip: 'Hybrid: Weekly schedule of in-office and remote days', style: '' },
        field_flexible: { label: 'Flexible / Remote', tooltip: 'Flexible / Remote: Check in from anywhere (no GPS restriction)', style: 'color: #ca8a04; border-color: rgba(202, 138, 4, 0.25);' },
        executive: { label: 'Flexible / Remote', tooltip: 'Flexible / Remote: Check in from anywhere (no GPS restriction)', style: 'color: #ca8a04; border-color: rgba(202, 138, 4, 0.25);' },
        office_only: { label: 'On-site Only', tooltip: 'On-site Only: 100% in-office attendance required daily', style: 'color: #2563eb; border-color: rgba(37, 99, 235, 0.25);' }
    };

    const rowsHtml = filteredStaff.map((entry) => {
        const isLocked = Boolean(entry.device_id || entry.deviceId);
        const pol = policyLabels[entry.schedule_policy] || policyLabels.weekly_hybrid;
        const polHtml = `<span class="staff-policy-tag"${pol.style ? ` style="${pol.style}"` : ''} data-tooltip="${escapeHtml(pol.tooltip || pol.label)}">${pol.label}</span>`;

        return `
        <div class="staff-row">
            <div class="staff-name-cell">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span style="font-weight:600; font-size:0.92rem; color:var(--text);">${escapeHtml(entry.name)}</span>
                    ${entry.is_team_lead ? '<span class="staff-lead-badge" data-tooltip="Team Lead: Has hybrid schedule priority"><i data-lucide="award"></i>Lead</span>' : ''}
                </div>
                <div style="font-size:0.76rem; color:var(--text-muted); font-weight:400; margin-top:2px;">
                    ${escapeHtml(entry.dept || 'General')}
                </div>
            </div>
            <div class="staff-policy-cell">
                ${polHtml}
            </div>
            <div class="staff-device-cell">
                <span class="staff-device-tag ${isLocked ? 'is-locked' : 'is-unlocked'}" data-tooltip="${isLocked ? 'Device bound to staff smartphone hardware' : 'Unlinked: Binds to device hardware on next check-in'}"><i data-lucide="${isLocked ? 'smartphone' : 'unlock'}"></i>${isLocked ? 'Linked' : 'Unlinked'}</span>
            </div>
            <div class="staff-actions">
                <button class="staff-action-btn" type="button" title="Edit ${escapeHtml(entry.name)}" data-tooltip="Edit staff & policy" data-tooltip-pos="left" data-edit-name="${escapeHtml(entry.name)}" aria-label="Edit staff"><i data-lucide="edit-2"></i></button>
                <button class="staff-action-btn" type="button" title="Unlink device for ${escapeHtml(entry.name)}" data-tooltip="Unlink device hardware lock" data-tooltip-pos="left" data-reset-name="${escapeHtml(entry.name)}" aria-label="Reset device lock"><i data-lucide="rotate-cw"></i></button>
                <button class="staff-action-btn danger" type="button" title="Remove ${escapeHtml(entry.name)}" data-tooltip="Remove staff member" data-tooltip-pos="left" data-remove-name="${escapeHtml(entry.name)}" aria-label="Remove staff"><i data-lucide="trash-2"></i></button>
            </div>
        </div>
    `;}).join('');

    if (!setHtmlIfChanged(staffList, headerHtml + rowsHtml)) return;
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();

    staffList.querySelectorAll('[data-edit-name]').forEach((button) => {
        button.addEventListener('click', () => handleEditStaff(button.getAttribute('data-edit-name')));
    });
    staffList.querySelectorAll('[data-reset-name]').forEach((button) => {
        button.addEventListener('click', () => handleResetStaffLock(button.getAttribute('data-reset-name')));
    });
    staffList.querySelectorAll('[data-remove-name]').forEach((button) => {
        button.addEventListener('click', () => handleRemoveStaff(button.getAttribute('data-remove-name')));
    });
}

async function handleEditStaff(name) {
    const member = (allStaffList || []).find(s => s.name === name);
    if (!member) return;

    const result = await showInlineDialog({
        title: `Edit Staff: ${name}`,
        fields: [
            { label: 'Department', placeholder: 'e.g. Media, Engineering, Operations', value: member.dept || 'General' },
            { 
                label: 'Work Policy', 
                type: 'select', 
                value: (member.schedule_policy === 'executive') ? 'field_flexible' : (member.schedule_policy || 'weekly_hybrid'),
                options: [
                    { value: 'weekly_hybrid', label: 'Hybrid' },
                    { value: 'field_flexible', label: 'Flexible / Remote' },
                    { value: 'office_only', label: 'On-site Only' }
                ]
            },
            {
                label: 'Team Lead Status',
                type: 'select',
                value: member.is_team_lead ? 'yes' : 'no',
                options: [
                    { value: 'no', label: 'Regular Team Member' },
                    { value: 'yes', label: 'Team Lead (Pinned to Top of Hybrid Grid)' }
                ]
            },
            {
                label: 'Attendance Reports Inclusion',
                type: 'select',
                value: member.include_in_reports !== false ? 'yes' : 'no',
                options: [
                    { value: 'yes', label: 'Yes - Include in Weekly Rates & Penalty Export' },
                    { value: 'no', label: 'No - Exclude from Attendance Penalty Reports' }
                ]
            }
        ],
        confirmLabel: 'Save Changes'
    });

    if (!result) return;
    const [dept, schedule_policy, isLeadStr, incReportsStr] = result;
    try {
        const res = await updateStaff(name, {
            dept: String(dept || 'General').trim(),
            schedule_policy,
            is_team_lead: isLeadStr === 'yes',
            include_in_reports: incReportsStr === 'yes'
        });
        showToast(res.message || 'Staff updated.', res.ok ? 'success' : 'error');
        if (res.ok) await loadStaffList();
    } catch (e) {
        showToast('Failed to update staff member.', 'error');
    }
}

async function loadStaffList(isSilent = false) {
    const staffList = document.getElementById('staff-list');
    
    // Check in-memory & localStorage cache for 0ms instant rendering
    if (allStaffList && allStaffList.length) {
        renderStaffList(allStaffList);
        populateStaffFilterDropdowns(allStaffList);
    } else {
        try {
            const stored = safeStorage.getItem('admin_cache_staff');
            if (stored) {
                allStaffList = JSON.parse(stored);
                renderStaffList(allStaffList);
                populateStaffFilterDropdowns(allStaffList);
            }
        } catch (e) {}
    }

    if ((!allStaffList || !allStaffList.length) && staffList && !isSilent) {
        staffList.innerHTML = `
            <div class="skeleton-box skeleton-row"></div>
            <div class="skeleton-box skeleton-row"></div>
            <div class="skeleton-box skeleton-row"></div>
        `;
    }

    try {
        const response = await listStaff();
        if (response.ok && response.staff) {
            allStaffList = response.staff;
            try { safeStorage.setItem('admin_cache_staff', JSON.stringify(response.staff)); } catch (e) {}
            renderStaffList(response.staff);
            populateStaffFilterDropdowns(response.staff);
        } else if (!allStaffList || !allStaffList.length) {
            if (staffList) staffList.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'Could not load staff list.')}</div>`;
        }
    } catch (error) {
        if ((!allStaffList || !allStaffList.length) && staffList && !isSilent) {
            staffList.innerHTML = '<div class="staff-list-state">Failed to reach the server.</div>';
        }
    }
}

function populateStaffFilterDropdowns(staff) {
    const filterSelect = document.getElementById('logs-filter-name-select');
    if (filterSelect) {
        const currentVal = filterSelect.value;
        filterSelect.innerHTML = '<option value="">All staff</option>' + staff.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
        if (currentVal) filterSelect.value = currentVal;
    }
}

async function handleAddStaff() {
    const input = document.getElementById('new-staff-name');
    const name = input.value.trim();
    if (!name) { showToast('Enter a staff name first.', 'error'); return; }
    if (name.length < 2) { showToast('Staff name must be at least 2 characters.', 'error'); return; }
    if (name.length > 50) { showToast('Staff name must be less than 50 characters.', 'error'); return; }
    if (!/^[a-zA-Z\s\-'.]+$/.test(name)) { showToast('Invalid characters in name.', 'error'); return; }
    
    const deptInput = document.getElementById('new-staff-dept');
    const dept = deptInput ? deptInput.value.trim() || 'General' : 'General';
    const policySelect = document.getElementById('new-staff-policy');
    const schedule_policy = policySelect ? policySelect.value : 'weekly_hybrid';
    const leadCheckbox = document.getElementById('new-staff-lead');
    const is_team_lead = leadCheckbox ? leadCheckbox.checked : false;
    const reportCheckbox = document.getElementById('new-staff-report');
    const include_in_reports = reportCheckbox ? reportCheckbox.checked : true;

    const addBtn = document.getElementById('add-staff-btn');
    addBtn.disabled = true;
    try {
        const response = await addStaff(name, dept, schedule_policy, is_team_lead, include_in_reports);
        showToast(response.message || 'Staff added.', response.ok ? 'success' : 'error');
        if (response.ok) {
            input.value = '';
            if (deptInput) deptInput.value = '';
            if (leadCheckbox) leadCheckbox.checked = false;
            await loadStaffList();
        }
    } catch (error) { showToast('Could not reach the server.', 'error'); }
    finally { addBtn.disabled = false; }
}

function parseStaffCsv(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];

    const results = [];
    let startIndex = 0;

    const firstLower = lines[0].toLowerCase();
    if (firstLower.includes('name') || firstLower.includes('staff') || firstLower.includes('department')) {
        startIndex = 1;
    }

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
        const name = parts[0];
        if (!name || name.length < 2) continue;

        const dept = parts[1] || 'General';
        let rawPolicy = (parts[2] || 'weekly_hybrid').toLowerCase().replace(/\s+/g, '_');
        let schedule_policy = 'weekly_hybrid';
        if (rawPolicy.includes('flex') || rawPolicy.includes('remote') || rawPolicy.includes('field') || rawPolicy.includes('media') || rawPolicy.includes('shoot') || rawPolicy.includes('exec') || rawPolicy.includes('leader')) {
            schedule_policy = 'field_flexible';
        } else if (rawPolicy.includes('office') || rawPolicy.includes('site') || rawPolicy.includes('onsite')) {
            schedule_policy = 'office_only';
        }

        const rawLead = (parts[3] || '').toLowerCase();
        const is_team_lead = ['yes', 'true', '1', 'y', 'lead'].includes(rawLead);

        const rawReport = (parts[4] || '').toLowerCase();
        const include_in_reports = parts[4] !== undefined
            ? !['no', 'false', '0', 'n', 'exclude'].includes(rawReport)
            : !(schedule_policy === 'field_flexible' || schedule_policy === 'executive');

        results.push({
            name,
            dept,
            schedule_policy,
            is_team_lead,
            include_in_reports
        });
    }

    return results;
}

async function handleImportStaffCsv() {
    const customHtml = `
        <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <input id="staff-csv-file-picker" type="file" accept=".csv,text/csv,text/plain" style="display:none;" />
                <button id="staff-csv-browse-btn" class="admin-btn secondary small" type="button"><i data-lucide="folder" size="13" style="vertical-align:middle; margin-right:4px;"></i> Choose .CSV File</button>
                <span id="staff-csv-filename" style="font-size:0.8rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:220px;">No file chosen</span>
            </div>
            <div>
                <label style="display:block; font-size:0.75rem; font-weight:600; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase;">Or Paste CSV Lines Below:</label>
                <textarea id="staff-csv-textarea" rows="6" placeholder="Name, Department, Policy, Team Lead, Include In Reports&#10;Adaeze, Operations, Hybrid, yes, yes&#10;Alex Taylor, Media, Flexible / Remote, no, no" style="width:100%; padding:9px 11px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--surface); color:var(--text); font-family:monospace; font-size:0.82rem; resize:vertical;"></textarea>
            </div>
            <div id="staff-csv-preview" style="font-size:0.78rem; color:var(--muted); line-height:1.4;">
                Format: <code>Name, Department, Policy, Team Lead, Include In Reports</code><br/>
                Policies: <code>Hybrid</code> (weekly_hybrid), <code>Flexible / Remote</code> (field_flexible), <code>On-site Only</code> (office_only)
            </div>
        </div>
    `;

    const confirmed = await new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.innerHTML = `
            <div class="dialog-box" style="max-width:520px; width:92vw;">
                <h3><i data-lucide="file-text" size="18" style="vertical-align:middle; margin-right:6px;"></i> Import Staff via CSV</h3>
                <p style="color:var(--text-muted); font-size:0.86rem; margin-bottom:12px;">Upload a CSV file or paste records to bulk add or configure staff policies.</p>
                ${customHtml}
                <div class="dialog-actions">
                    <button id="csv-cancel-btn" class="admin-btn secondary" type="button">Cancel</button>
                    <button id="csv-confirm-btn" class="admin-btn" type="button">Import Staff</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();

        const fileInput = overlay.querySelector('#staff-csv-file-picker');
        const browseBtn = overlay.querySelector('#staff-csv-browse-btn');
        const filenameEl = overlay.querySelector('#staff-csv-filename');
        const textarea = overlay.querySelector('#staff-csv-textarea');
        const previewEl = overlay.querySelector('#staff-csv-preview');
        const cancelBtn = overlay.querySelector('#csv-cancel-btn');
        const confirmBtn = overlay.querySelector('#csv-confirm-btn');

        browseBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
                filenameEl.textContent = file.name;
                const reader = new FileReader();
                reader.onload = (evt) => {
                    textarea.value = evt.target.result;
                    updatePreview();
                };
                reader.readAsText(file);
            }
        });

        textarea.addEventListener('input', updatePreview);

        function updatePreview() {
            const parsed = parseStaffCsv(textarea.value);
            if (parsed.length) {
                previewEl.innerHTML = `<span style="color:#10b981; font-weight:600;">Ready to import ${parsed.length} staff member${parsed.length > 1 ? 's' : ''}</span>`;
            } else {
                previewEl.innerHTML = `Format: <code>Name, Department, Policy, Team Lead, Include In Reports</code>`;
            }
        }

        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(null);
        });

        confirmBtn.addEventListener('click', () => {
            const parsed = parseStaffCsv(textarea.value);
            overlay.remove();
            resolve(parsed);
        });
    });

    if (!confirmed || !confirmed.length) {
        if (confirmed !== null) showToast('No valid staff records to import.', 'error');
        return;
    }

    try {
        showToast(`Importing ${confirmed.length} staff members...`, 'info');
        const response = await callBackend({ mode: 'batch-import-staff', staff: confirmed });
        showToast(response.message || 'Staff import complete.', response.ok ? 'success' : 'error');
        if (response.ok) await loadStaffList();
    } catch(e) {
        showToast('Failed to import staff.', 'error');
    }
}

async function handleRemoveStaff(name) {
    const confirmed = await confirmDialog(`Remove ${name} from staff list? Cannot be undone.`, { danger: true, confirmLabel: 'Remove' });
    if (!confirmed) return;
    try {
        const response = await removeStaffRecord(name);
        showToast(response.message || 'Staff removed.', response.ok ? 'success' : 'error');
        if (response.ok) await loadStaffList();
    } catch (error) { showToast('Could not reach the server.', 'error'); }
}

async function handleResetStaffLock(name) {
    const confirmed = await confirmDialog(`Unlink device for ${name}? They will be able to link a new phone on their next sign-in.`, { confirmLabel: 'Unlink Device' });
    if (!confirmed) return;
    try {
        const response = await resetStaffLock(name);
        showToast(response.message || 'Device unlinked.', response.ok ? 'success' : 'error');
        if (response.ok) await loadStaffList();
    } catch (error) { showToast('Could not reach the server.', 'error'); }
}

async function handleResetAllLocks() {
    const confirmed = await confirmDialog('Unlink devices for ALL staff? Everyone will be able to link a new phone on their next sign-in. This cannot be undone.', { danger: true, confirmLabel: 'Unlink All' });
    if (!confirmed) return;
    try {
        const response = await resetAllLocks();
        showToast(response.message || 'All devices unlinked.', response.ok ? 'success' : 'error');
        if (response.ok) await loadStaffList();
    } catch (error) { showToast('Could not reach the server.', 'error'); }
}

/* ============================================================
   LOGS TAB
   ============================================================ */

let logsAllRecords = [];
let logsCurrentPage = 1;
let logsPageSize = 20;

async function loadLogsViewer(isSilent = false) {
    const host = document.getElementById('logs-list');
    
    // Check in-memory & localStorage cache for 0ms instant rendering
    if (logsAllRecords && logsAllRecords.length) {
        renderLogsTable();
    } else {
        try {
            const stored = safeStorage.getItem('admin_cache_logs');
            if (stored) {
                logsAllRecords = JSON.parse(stored);
                renderLogsTable();
            }
        } catch (e) {}
    }

    if ((!logsAllRecords || !logsAllRecords.length) && host && !isSilent) {
        host.innerHTML = `
            <div class="skeleton-box skeleton-row"></div>
            <div class="skeleton-box skeleton-row"></div>
            <div class="skeleton-box skeleton-row"></div>
        `;
    }

    const nameFilter = document.getElementById('logs-filter-name-select')?.value || '';
    const fromInput = document.getElementById('logs-filter-from')?.value || '';
    const toInput = document.getElementById('logs-filter-to')?.value || '';

    try {
        const response = await fetchLogs({
            name: nameFilter || undefined,
            fromDate: isoDateToDdMmYyyy(fromInput) || undefined,
            toDate: isoDateToDdMmYyyy(toInput) || undefined,
            limit: 200
        });
        if (response.ok && Array.isArray(response.logs)) {
            logsAllRecords = response.logs;
            try { safeStorage.setItem('admin_cache_logs', JSON.stringify(response.logs)); } catch (e) {}
            logsCurrentPage = 1;
            renderLogsTable();
        } else if (!logsAllRecords || !logsAllRecords.length) {
            logsAllRecords = [];
            if (host) host.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'No records found.')}</div>`;
        }
    } catch (error) {
        if (!logsAllRecords || !logsAllRecords.length) {
            logsAllRecords = [];
            if (host) host.innerHTML = '<div class="staff-list-state">Failed to reach the server.</div>';
        }
    }
}

function normalizeAttendanceStatus(status = '') {
    const value = (status || '').toString().trim().toLowerCase();
    if (value.includes('late')) return 'late';
    if (value.includes('early')) return 'early';
    if (value.includes('miss')) return 'missed';
    if (value.includes('on time') || value.includes('on-time') || value.includes('verified') || value.includes('normal') || value.includes('welcome')) return 'ontime';
    return 'default';
}

function getStatusBadgeClass(status = '') {
    switch (normalizeAttendanceStatus(status)) {
        case 'late':
        case 'early':
            return 'late';
        case 'missed':
            return 'offline';
        default:
            return 'synced';
    }
}

function getStatusLabel(status = '') {
    const value = (status || '').toString().trim();
    switch (normalizeAttendanceStatus(status)) {
        case 'late':
            return 'Late';
        case 'early':
            return 'Early Out';
        case 'missed':
            return 'Missed';
        case 'ontime':
            return 'On Time';
        default:
            return value || 'Unknown';
    }
}

function renderLogsTable() {
    const host = document.getElementById('logs-list');
    if (!host) return;
    const logs = logsAllRecords;
    if (!logs.length) { host.innerHTML = '<div class="staff-list-state">No records match this filter.</div>'; return; }

    const totalPages = Math.max(1, Math.ceil(logs.length / logsPageSize));
    if (logsCurrentPage > totalPages) logsCurrentPage = totalPages;
    const startIdx = (logsCurrentPage - 1) * logsPageSize;
    const pageLogs = logs.slice(startIdx, startIdx + logsPageSize);

    const sortIndicator = (field) => {
        if (logsSortField !== field) return '';
        return logsSortAsc ? ' ▲' : ' ▼';
    };

    host.innerHTML = `
        <div class="logs-table-wrapper">
            <div class="logs-table">
                <div class="logs-row logs-head" style="user-select:none;">
                    <span style="cursor:pointer;" data-sort-field="date">Date${sortIndicator('date')}</span>
                    <span style="cursor:pointer;" data-sort-field="name">Name${sortIndicator('name')}</span>
                    <span style="cursor:pointer;" data-sort-field="action">Action${sortIndicator('action')}</span>
                    <span style="cursor:pointer;" data-sort-field="time">Time${sortIndicator('time')}</span>
                    <span style="cursor:pointer;" data-sort-field="status">Status${sortIndicator('status')}</span>
                    <span>Distance</span>
                </div>
                ${pageLogs.map(entry => `
                    <div class="logs-row">
                        <span>${escapeHtml(entry.date)}</span>
                        <span>${escapeHtml(entry.name)}</span>
                        <span class="logs-action ${entry.action === 'IN' ? 'in' : 'out'}">${escapeHtml(entry.action)}</span>
                        <span>${escapeHtml(entry.time)}</span>
                        <span><span class="status-pill-small ${getStatusBadgeClass(entry.status)}">${escapeHtml(getStatusLabel(entry.status))}</span></span>
                        <span>${escapeHtml(entry.distance ? entry.distance + ' meters' : '-')}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="logs-footer">
            <span>${logs.length} records — page ${logsCurrentPage} of ${totalPages}</span>
            <div class="pagination-controls">
                <div class="page-size-select">
                    <label for="logs-page-size">Show</label>
                    <select id="logs-page-size" aria-label="Records per page">
                        <option value="20" ${logsPageSize === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${logsPageSize === 50 ? 'selected' : ''}>50</option>
                    </select>
                </div>
                <button id="logs-prev-page-btn" class="admin-btn secondary small" type="button" ${logsCurrentPage <= 1 ? 'disabled' : ''}>‹ Prev</button>
                <button id="logs-next-page-btn" class="admin-btn secondary small" type="button" ${logsCurrentPage >= totalPages ? 'disabled' : ''}>Next ›</button>
            </div>
            <button id="export-logs-btn" class="admin-btn secondary small" type="button"><i data-lucide="download" size="13" style="vertical-align:middle; margin-right:4px;"></i> Export CSV</button>
        </div>
    `;

    host.querySelectorAll('[data-sort-field]').forEach((header) => {
        header.addEventListener('click', () => {
            const field = header.getAttribute('data-sort-field');
            if (logsSortField === field) {
                logsSortAsc = !logsSortAsc;
            } else {
                logsSortField = field;
                logsSortAsc = true;
            }
            logsAllRecords.sort((a, b) => {
                const valA = String(a[field] || '').toLowerCase();
                const valB = String(b[field] || '').toLowerCase();
                return logsSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            });
            renderLogsTable();
        });
    });

    document.getElementById('logs-page-size')?.addEventListener('change', (e) => {
        logsPageSize = parseInt(e.target.value, 10) || 20;
        logsCurrentPage = 1;
        renderLogsTable();
    });
    document.getElementById('logs-prev-page-btn')?.addEventListener('click', () => {
        if (logsCurrentPage > 1) { logsCurrentPage--; renderLogsTable(); }
    });
    document.getElementById('logs-next-page-btn')?.addEventListener('click', () => {
        if (logsCurrentPage < totalPages) { logsCurrentPage++; renderLogsTable(); }
    });
    document.getElementById('export-logs-btn')?.addEventListener('click', () => exportToCSV(logs, 'attendance_logs'));
}

/* ============================================================
   ANALYTICS TAB
   ============================================================ */

function isExemptFromAnalytics(name) {
    return !isStaffIncludedInReports(name);
}

function processAnalyticsData(logs, schedule, filterType = 'all', customFromDate = null, customToDate = null) {
    if (!logs || !logs.length) return null;
    
    const now = new Date();
    let startDate = null, endDate = null;

    if (filterType === 'month') {
        // 1st calendar day of current month to today
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (filterType === 'week') {
        // Monday of current week to today
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        startDate = new Date(now.getFullYear(), now.getMonth(), diff);
        endDate = new Date(now.getFullYear(), now.getMonth(), diff + 6, 23, 59, 59);
    } else if (filterType === 'custom' && customFromDate) {
        const p1 = customFromDate.split('-');
        startDate = parseDmyDate(customFromDate) || (p1.length === 3 ? new Date(parseInt(p1[0], 10), parseInt(p1[1], 10)-1, parseInt(p1[2], 10)) : new Date(customFromDate));
        
        const p2 = customToDate ? customToDate.split('-') : [];
        endDate = customToDate ? (parseDmyDate(customToDate) || (p2.length === 3 ? new Date(parseInt(p2[0], 10), parseInt(p2[1], 10)-1, parseInt(p2[2], 10)) : new Date(customToDate))) : new Date();
        
        if (startDate) startDate.setHours(0, 0, 0, 0);
        if (endDate) endDate.setHours(23, 59, 59, 999);
        
        if (startDate && endDate && startDate > endDate) {
            const temp = new Date(startDate);
            startDate = new Date(endDate);
            endDate = temp;
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        }
    }

    const filteredLogs = logs.filter(entry => {
        if (!startDate) return true;
        const entryDate = parseDmyDate(entry.date) || new Date(entry.timestamp || entry.date);
        if (isNaN(entryDate.getTime())) return true;
        return entryDate >= startDate && entryDate <= endDate;
    });

    const staffCounts = {};
    let lateCount = 0, earlyOutCount = 0;
    const totalDays = new Set();
    
    filteredLogs.forEach(entry => {
        const name = entry.name;
        if (isExemptFromAnalytics(name)) return;
        if (!staffCounts[name]) staffCounts[name] = { in: 0, out: 0, late: 0, earlyOut: 0, wfhDays: 0, daysPresent: new Set() };
        if (entry.action === 'IN') staffCounts[name].in++;
        if (entry.action === 'OUT') staffCounts[name].out++;
        const statusType = normalizeAttendanceStatus(entry.status);
        if (statusType === 'late') {
            lateCount++;
            if (entry.action === 'IN') staffCounts[name].late++;
        }
        if (statusType === 'early' && entry.action === 'OUT') {
            earlyOutCount++;
            staffCounts[name].earlyOut++;
        }
        if (entry.date) {
            totalDays.add(entry.date);
            staffCounts[name].daysPresent.add(entry.date);
        }
    });
    
    Object.entries(schedule).forEach(([name, days]) => {
        if (isExemptFromAnalytics(name)) return;
        if (!staffCounts[name]) {
            staffCounts[name] = { in: 0, out: 0, late: 0, earlyOut: 0, wfhDays: 0, daysPresent: new Set() };
        }
        if (Array.isArray(days)) {
            // Array format: [{date, location}, ...] or [{day, location}, ...]
            days.forEach(d => {
                if (String(d.location || '').toLowerCase() === 'home') staffCounts[name].wfhDays++;
            });
        } else if (days && typeof days === 'object') {
            // Plain object format from GAS: { Monday: "Office", Tuesday: "Home", ... }
            Object.values(days).forEach(loc => {
                if (String(loc || '').toLowerCase() === 'home') staffCounts[name].wfhDays++;
            });
        }
    });
    
    const totalDaysInRange = totalDays.size;
    
    const staffBreakdown = Object.entries(staffCounts)
        .map(([name, counts]) => ({
            name,
            signIns: counts.in,
            signOuts: counts.out,
            totalActions: counts.in + counts.out,
            lateCount: counts.late,
            earlyOutCount: counts.earlyOut,
            wfhDays: counts.wfhDays,
            daysPresent: counts.daysPresent.size,
            expectedOfficeDays: totalDaysInRange - counts.wfhDays,
            attendanceRate: totalDaysInRange > 0 
                ? (tenantWfhQuotaEnabled
                    ? Math.min(100, Math.round(((counts.daysPresent.size + counts.wfhDays) / Math.max(totalDaysInRange, 1)) * 100))
                    : Math.round((counts.daysPresent.size / Math.max(totalDaysInRange, 1)) * 100))
                : 0
        }))
        .sort((a, b) => a.totalActions - b.totalActions);
    
    return {
        totalEntries: filteredLogs.length,
        uniqueStaff: Object.keys(staffCounts).length,
        totalDays: totalDaysInRange,
        lateCount,
        earlyOutCount,
        latePercentage: filteredLogs.length ? ((lateCount / filteredLogs.length) * 100).toFixed(1) : 0,
        leastActive: staffBreakdown.slice(0, 3),
        mostActive: [...staffBreakdown].reverse().slice(0, 3),
        staffBreakdown
    };
}

function renderAnalytics() {
    const host = document.getElementById('analytics-content');
    if (!host) return;
    
    if (!analyticsData) {
        host.innerHTML = '<div class="staff-list-state">No data available for analytics. Load the Dashboard first.</div>';
        return;
    }
    
    const data = analyticsData;
    const deviceEvents = deviceEventsAll;
    const totalEventPages = Math.max(1, Math.ceil(deviceEvents.length / DEVICE_EVENTS_PAGE_SIZE));
    if (deviceEventsPage > totalEventPages) deviceEventsPage = totalEventPages;
    const eventsStart = (deviceEventsPage - 1) * DEVICE_EVENTS_PAGE_SIZE;
    const pageEvents = deviceEvents.slice(eventsStart, eventsStart + DEVICE_EVENTS_PAGE_SIZE);
    
    if (!setHtmlIfChanged(host, `
        <div class="analytics-grid">
            <div class="analytics-card">
                <span class="analytics-icon"><i data-lucide="bar-chart-2" size="20"></i></span>
                <div><span class="analytics-number">${data.totalEntries}</span><span class="analytics-label">Records</span></div>
            </div>
            <div class="analytics-card">
                <span class="analytics-icon"><i data-lucide="users" size="20"></i></span>
                <div><span class="analytics-number">${data.uniqueStaff}</span><span class="analytics-label">Staff</span></div>
            </div>
            <div class="analytics-card">
                <span class="analytics-icon"><i data-lucide="calendar" size="20"></i></span>
                <div><span class="analytics-number">${data.totalDays}</span><span class="analytics-label">Active Days</span></div>
            </div>
            <div class="analytics-card ${data.latePercentage > 20 ? 'warning' : 'ok'}">
                <span class="analytics-icon"><i data-lucide="clock" size="20"></i></span>
                <div><span class="analytics-number">${data.latePercentage}%</span><span class="analytics-label">Late Rate</span></div>
            </div>
        </div>
        
        <div class="analytics-section">
            <h4><i data-lucide="alert-triangle" size="16" style="vertical-align:middle; margin-right:5px; color:#eab308;"></i> Least Active Staff</h4>
            <p class="admin-intro">Staff with lowest office attendance rate. Scheduled Home days are excluded from requirements.</p>
            <div class="analytics-table-wrapper">
                <div class="analytics-table">
                    <div class="breakdown-row breakdown-head">
                        <span>Staff Name</span>
                        <span>Progress</span>
                        <span class="col-center">Sign In</span>
                        <span class="col-center">Sign Out</span>
                        <span class="col-center">Rate</span>
                        <span class="col-center">Home</span>
                        <span class="col-center">Late</span>
                    </div>
                    ${data.leastActive.map(s => `
                        <div class="breakdown-row">
                            <span class="breakdown-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
                            <span class="breakdown-bar-col">
                                <div class="breakdown-bar"><span class="bar-in ${s.attendanceRate >= 80 ? 'bar-high' : s.attendanceRate >= 50 ? 'bar-mid' : 'bar-low'}" style="width: ${Math.max(4, Math.min(100, s.attendanceRate))}%"></span></div>
                            </span>
                            <span class="stat-cell stat-in">${s.signIns} in</span>
                            <span class="stat-cell stat-out">${s.signOuts} out</span>
                            <span class="stat-cell ${s.attendanceRate < 60 ? 'stat-late-val' : 'stat-in-val'}">${s.attendanceRate}%</span>
                            <span class="stat-cell stat-wfh">${s.wfhDays}</span>
                            <span class="stat-cell stat-late">${s.lateCount > 0 ? `<span style="color:#dc2626; font-weight:600;">Late: ${s.lateCount}</span>` : '-'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <div class="analytics-section">
            <h4><i data-lucide="award" size="16" style="vertical-align:middle; margin-right:5px; color:#f59e0b;"></i> Most Active Staff</h4>
            <div class="analytics-table-wrapper">
                <div class="analytics-table">
                    <div class="breakdown-row breakdown-head">
                        <span>Staff Name</span>
                        <span>Progress</span>
                        <span class="col-center">Sign In</span>
                        <span class="col-center">Sign Out</span>
                        <span class="col-center">Rate</span>
                        <span class="col-center">Home</span>
                        <span class="col-center">Late</span>
                    </div>
                    ${data.mostActive.map(s => `
                        <div class="breakdown-row">
                            <span class="breakdown-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
                            <span class="breakdown-bar-col">
                                <div class="breakdown-bar"><span class="bar-in ${s.attendanceRate >= 80 ? 'bar-high' : s.attendanceRate >= 50 ? 'bar-mid' : 'bar-low'}" style="width: ${Math.max(4, Math.min(100, s.attendanceRate))}%"></span></div>
                            </span>
                            <span class="stat-cell stat-in">${s.signIns} in</span>
                            <span class="stat-cell stat-out">${s.signOuts} out</span>
                            <span class="stat-cell stat-in-val">${s.attendanceRate}%</span>
                            <span class="stat-cell stat-wfh">${s.wfhDays}</span>
                            <span class="stat-cell stat-late">${s.lateCount > 0 ? `<span style="color:#dc2626; font-weight:600;">Late: ${s.lateCount}</span>` : '-'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <div class="analytics-section">
            <h4><i data-lucide="list" size="16" style="vertical-align:middle; margin-right:5px;"></i> Full Staff Breakdown</h4>
            <div class="analytics-table-wrapper">
                <div class="analytics-table">
                    <div class="breakdown-row breakdown-head">
                        <span>Staff Name</span>
                        <span>Progress</span>
                        <span class="col-center">Sign In</span>
                        <span class="col-center">Sign Out</span>
                        <span class="col-center">Rate</span>
                        <span class="col-center">Home</span>
                        <span class="col-center">Late</span>
                    </div>
                    ${data.staffBreakdown.map(s => `
                        <div class="breakdown-row">
                            <span class="breakdown-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
                            <span class="breakdown-bar-col">
                                <div class="breakdown-bar"><span class="bar-in ${s.attendanceRate >= 80 ? 'bar-high' : s.attendanceRate >= 50 ? 'bar-mid' : 'bar-low'}" style="width: ${Math.max(4, Math.min(100, s.attendanceRate))}%"></span></div>
                            </span>
                            <span class="stat-cell stat-in">${s.signIns} in</span>
                            <span class="stat-cell stat-out">${s.signOuts} out</span>
                            <span class="stat-cell ${s.attendanceRate < 60 ? 'stat-late-val' : 'stat-in-val'}">${s.attendanceRate}%</span>
                            <span class="stat-cell stat-wfh">${s.wfhDays}</span>
                            <span class="stat-cell stat-late">${s.lateCount > 0 ? `<span style="color:#dc2626; font-weight:600;">Late: ${s.lateCount}</span>` : '-'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <div class="logs-footer">
            <button id="export-analytics-btn" class="admin-btn secondary small" type="button"><i data-lucide="download" size="13" style="vertical-align:middle; margin-right:4px;"></i> Export CSV</button>
        </div>
        
        <div class="analytics-section">
            <h4><i data-lucide="shield-alert" size="16" style="vertical-align:middle; margin-right:5px; color:#dc2626;"></i> Device & System Audit Events</h4>
            <p class="admin-intro">Real-time log entries recorded from Database Audit Log, Distance Alerts, and device security events.</p>
            ${deviceEvents.length > 0 ? `
            <div class="logs-table-wrapper">
                <div class="logs-table" style="min-width:500px">
                    <div class="logs-row logs-head" style="grid-template-columns:1.2fr 1.4fr 2.4fr">
                        <span>Time</span><span>Type</span><span>Details</span>
                    </div>
                    ${pageEvents.map(e => `
                        <div class="logs-row" style="grid-template-columns:1.2fr 1.4fr 2.4fr">
                            <span style="font-size:0.75rem">${escapeHtml(e.time || '')}</span>
                            <span class="status-pill-small ${e.type.includes('error') || e.type.includes('geofence') || e.type.includes('VIOLATION') ? 'late' : 'synced'}">${escapeHtml(e.type)}</span>
                            <span style="font-size:0.75rem;word-break:break-all">${escapeHtml(e.details || '')}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="logs-footer">
                <span>${deviceEvents.length} events — page ${deviceEventsPage} of ${totalEventPages}</span>
                <div class="pagination-controls">
                    <button id="device-events-prev-btn" class="admin-btn secondary small" type="button" ${deviceEventsPage <= 1 ? 'disabled' : ''}>‹ Prev</button>
                    <button id="device-events-next-btn" class="admin-btn secondary small" type="button" ${deviceEventsPage >= totalEventPages ? 'disabled' : ''}>Next ›</button>
                </div>
            </div>
            ` : '<div class="staff-list-state">No device errors, distance alerts, or system audit events recorded.</div>'}
        </div>
    `)) return;
    
    document.getElementById('export-analytics-btn')?.addEventListener('click', () => {
        const exportData = analyticsData.staffBreakdown.map(s => ({
            Name: s.name, 'Sign Ins': s.signIns, 'Sign Outs': s.signOuts,
            'Late': s.lateCount, 'Home Days': s.wfhDays, 'Attendance Rate': s.attendanceRate + '%'
        }));
        exportToCSV(exportData, 'attendance_analytics');
    });

    document.getElementById('device-events-prev-btn')?.addEventListener('click', () => {
        if (deviceEventsPage > 1) { deviceEventsPage--; renderAnalytics(); }
    });
    document.getElementById('device-events-next-btn')?.addEventListener('click', () => {
        if (deviceEventsPage < totalEventPages) { deviceEventsPage++; renderAnalytics(); }
    });
}

let analyticsData = null;
let deviceEventsAll = [];
let deviceEventsPage = 1;
const DEVICE_EVENTS_PAGE_SIZE = 10;

async function fetchDistanceAlerts(limit = 100) {
    return callBackend({ mode: 'list-distance-alerts', limit });
}

async function fetchAuditLogs(limit = 100) {
    return callBackend({ mode: 'list-audit-logs', limit });
}

function parseEventTimestamp(dateStr, timeStr) {
    const dateParts = String(dateStr || '').split('/');
    if (dateParts.length !== 3) return 0;
    const day = parseInt(dateParts[0], 10), month = parseInt(dateParts[1], 10) - 1, year = parseInt(dateParts[2], 10);
    if (!timeStr) return new Date(year, month, day).getTime();

    const ampmMatch = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampmMatch) {
        let hour = parseInt(ampmMatch[1], 10) % 12;
        if (/pm/i.test(ampmMatch[3])) hour += 12;
        return new Date(year, month, day, hour, parseInt(ampmMatch[2], 10)).getTime();
    }
    const hmsMatch = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (hmsMatch) {
        return new Date(year, month, day, parseInt(hmsMatch[1], 10), parseInt(hmsMatch[2], 10), parseInt(hmsMatch[3] || '0', 10)).getTime();
    }
    return new Date(year, month, day).getTime();
}

let currentAnalyticsFilter = 'all';
let currentAnalyticsFrom = null;
let currentAnalyticsTo = null;

async function loadAnalytics(filterType = null, customFrom = null, customTo = null, isSilent = false) {
    if (filterType) {
        currentAnalyticsFilter = filterType;
        currentAnalyticsFrom = customFrom;
        currentAnalyticsTo = customTo;
    } else {
        filterType = currentAnalyticsFilter;
        customFrom = currentAnalyticsFrom;
        customTo = currentAnalyticsTo;
    }
    
    const host = document.getElementById('analytics-content');
    
    let hasLoadedFromCache = false;
    // Check in-memory or localStorage cache for 0ms instant rendering
    if (analyticsData && filterType === 'all' && !customFrom) {
        renderAnalytics();
        hasLoadedFromCache = true;
    } else if (filterType === 'all' && !customFrom) {
        try {
            const stored = safeStorage.getItem('admin_cache_analytics');
            if (stored) {
                const parsed = JSON.parse(stored);
                analyticsData = parsed.analyticsData;
                deviceEventsAll = parsed.deviceEventsAll || [];
                renderAnalytics();
                hasLoadedFromCache = true;
            }
        } catch (e) {}
    }

    if (host && !isSilent && !hasLoadedFromCache) {
        host.innerHTML = `
            <div class="skeleton-box skeleton-card" style="margin-bottom:12px;"></div>
            <div class="skeleton-box skeleton-row"></div>
            <div class="skeleton-box skeleton-row"></div>
        `;
    }
    
    try {
        const allSchedule = Object.values(cachedWeekData).reduce((acc, w) => ({ ...acc, ...((w && w.schedule) || {}) }), {});
        
        const [attendanceLogs, analyticsResponse, alertsResponse, auditResponse] = await Promise.all([
            fetchLogs({ limit: 1000 })
                .then(r => (r && r.ok && Array.isArray(r.logs)) ? r.logs : [])
                .catch((err) => { console.warn('fetchLogs failed:', err); return []; }),
            callBackend({ mode: 'list-analytics', limit: 50 }).catch((err) => { console.warn('list-analytics fetch failed:', err); return { ok: false, events: [] }; }),
            fetchDistanceAlerts(100).catch((err) => { console.warn('list-distance-alerts fetch failed:', err); return { ok: false, alerts: [] }; }),
            fetchAuditLogs(100).catch((err) => { console.warn('list-audit-logs fetch failed:', err); return { ok: false, events: [] }; })
        ]);

        analyticsData = processAnalyticsData(attendanceLogs, allSchedule, filterType, customFrom, customTo);

        const clientEvents = (analyticsResponse.ok && Array.isArray(analyticsResponse.events))
            ? analyticsResponse.events.map(e => {
                const [datePart, timePart] = String(e.time || '').split(' ');
                return {
                    type: e.type,
                    details: typeof e.details === 'string' ? e.details : JSON.stringify(e.details || {}),
                    time: e.time || '',
                    sortValue: parseEventTimestamp(datePart, timePart)
                };
            })
            : [];

        const geofenceEvents = (alertsResponse.ok && (Array.isArray(alertsResponse.alerts) || Array.isArray(alertsResponse.logs)))
            ? (alertsResponse.alerts || alertsResponse.logs || []).map(a => ({
                type: 'LOCATION_ALERT',
                details: `${a.name} attempted ${a.action} from ~${a.distance}m away (outside office radius)`,
                time: `${a.date} ${a.time}`,
                sortValue: parseEventTimestamp(a.date, a.time)
            }))
            : [];

        const auditEvents = (auditResponse.ok && (Array.isArray(auditResponse.events) || Array.isArray(auditResponse.logs)))
            ? (auditResponse.events || auditResponse.logs || []).map(a => ({
                type: a.event_type || a.eventType || a.category || 'SYSTEM_AUDIT',
                details: `${a.user_staff || a.user ? (a.user_staff || a.user) + ': ' : ''}${a.details || ''}`,
                time: `${a.date || ''} ${a.time || ''}`.trim(),
                sortValue: parseEventTimestamp(a.date, a.time)
            }))
            : [];

        deviceEventsAll = [...clientEvents, ...geofenceEvents, ...auditEvents].sort((a, b) => b.sortValue - a.sortValue);
        deviceEventsPage = 1;

        renderAnalytics();
        if (filterType === 'all' && !customFrom) {
            try { safeStorage.setItem('admin_cache_analytics', JSON.stringify({ analyticsData, deviceEventsAll })); } catch (e) {}
        }
    } catch (error) {
        console.error('loadAnalytics failed:', error);
        if (host && !analyticsData) host.innerHTML = '<div class="staff-list-state">Failed to load analytics.</div>';
        else if (host) showToast('Could not refresh analytics data (offline).', 'error');
    }
}

/* ============================================================
   RENDER ADMIN PANEL
   ============================================================ */

function renderAdminPanel() {
    const panelHost = document.getElementById('admin-panel-host');
    const isSuper = safeSession.getItem('is_superuser') === 'true';
    const roleTier = safeSession.getItem('admin_role_tier') || 'admin';
    const isMasquerading = safeSession.getItem('is_masquerading') === 'true';
    const masqueradeTenant = safeSession.getItem('masquerade_tenant') || (currentTenantConfig ? currentTenantConfig.slug : '');

    const badgeContainer = document.getElementById('topbar-badge-container');
    if (badgeContainer) {
        if (roleTier === 'developer' && (isSuper || isMasquerading)) {
            badgeContainer.innerHTML = `<span class="dev-mode-pill" title="Developer Operator Session" style="font-size:0.68rem; font-weight:700; background:rgba(99, 102, 241, 0.15); color:#818cf8; border:1px solid rgba(99, 102, 241, 0.35); padding:2px 7px; border-radius:6px; display:inline-flex; align-items:center; gap:4px; letter-spacing:0.04em;"><i data-lucide="terminal" size="11"></i> DEVELOPER</span>`;
        } else {
            badgeContainer.innerHTML = '';
        }
    }

    const titleWrap = document.getElementById('admin-workspace-title');
    const tenantNameEl = document.getElementById('admin-header-tenant-name');
    if (currentTenantConfig && titleWrap) {
        titleWrap.style.display = 'flex';
        if (tenantNameEl) tenantNameEl.textContent = currentTenantConfig.name || 'Company Workspace';
    }

    const masqueradeBanner = isMasquerading ? `
        <div class="operator-masquerade-banner" style="background: linear-gradient(90deg, #1e1b4b, #312e81); border: 1px solid #6366f1; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #e0e7ff; font-size: 0.82rem;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <i data-lucide="shield-alert" size="16" style="color: #a5b4fc; flex-shrink: 0;"></i>
                <span><strong>PLATFORM OPERATOR MODE:</strong> Masquerading as Developer for workspace <code>${escapeHtml(masqueradeTenant)}</code>. Password bypassed.</span>
            </div>
            <button type="button" onclick="handleLogout(false)" style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); color: #fff; padding: 4px 10px; border-radius: 5px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;">Exit Masquerade</button>
        </div>
    ` : '';

    panelHost.innerHTML = `
        ${masqueradeBanner}
        <div class="admin-tabs">
            <button class="tab-btn active" data-tab="dashboard" title="Dashboard"><span class="tab-icon"><i data-lucide="layout-dashboard" size="14"></i></span><span class="tab-label">Dashboard</span></button>
            <button class="tab-btn" data-tab="staff" title="Staff"><span class="tab-icon"><i data-lucide="users" size="14"></i></span><span class="tab-label">Staff</span></button>
            <button class="tab-btn" data-tab="logs" title="Logs"><span class="tab-icon"><i data-lucide="clipboard-list" size="14"></i></span><span class="tab-label">Logs</span></button>
            <button class="tab-btn" data-tab="analytics" title="Analytics"><span class="tab-icon"><i data-lucide="line-chart" size="14"></i></span><span class="tab-label">Analytics</span></button>
            <button class="tab-btn" data-tab="config" title="Config"><span class="tab-icon"><i data-lucide="settings" size="14"></i></span><span class="tab-label">Config</span></button>
            <button class="tab-btn" data-tab="account" title="Account"><span class="tab-icon"><i data-lucide="shield" size="14"></i></span><span class="tab-label">Account</span></button>
        </div>
        
        <div id="tab-dashboard" class="tab-content active">
            <div class="dashboard-header">
                <div class="week-navigator">
                    <button id="week-prev-btn" class="admin-btn secondary small" type="button" data-tooltip="View previous week">‹ Prev</button>
                    <span id="week-label" class="week-label">Loading...</span>
                    <button id="week-next-btn" class="admin-btn secondary small" type="button" data-tooltip="View next week">Next ›</button>
                </div>
                <div class="dashboard-actions">
                    <span id="refresh-label" class="refresh-label"></span>
                    <button id="refresh-today-btn" class="admin-btn secondary small" type="button" title="Refresh" data-tooltip="Refresh live attendance feed"><i data-lucide="refresh-cw" size="13"></i></button>
                </div>
            </div>
            <div id="today-attendance-list"><div class="staff-list-state">Loading this week...</div></div>
            <div class="dashboard-section">
                <h4>Weekly Attendance Matrix</h4>
                <div id="attendance-matrix"><div class="staff-list-state">Loading matrix...</div></div>
            </div>
            <div class="dashboard-quick-actions" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
                <button id="dashboard-export-btn" class="admin-btn secondary small" type="button" data-tooltip="Download weekly check-in logs as CSV">
                    <i data-lucide="download" size="13"></i> Export Week (CSV)
                </button>
                <button id="dashboard-print-btn" class="admin-btn secondary small" type="button" onclick="printWeeklyAttendanceReport()" data-tooltip="Generate clean printable weekly roster summary">
                    <i data-lucide="printer" size="13"></i> Printable Report (HTML)
                </button>
                <a class="admin-btn secondary small" href="../hybrid/?key=admin" target="_blank" rel="noopener" style="text-decoration:none;" data-tooltip="Open full-screen interactive hybrid schedule matrix">
                    <i data-lucide="calendar" size="13"></i> Hybrid Scheduler
                </a>
                <button class="admin-btn secondary small" type="button" onclick="openTenantTourModal(0)" data-tooltip="Launch step-by-step onboarding walkthrough">
                    <i data-lucide="help-circle" size="13"></i> Quick Guide
                </button>
            </div>
        </div>
        
        <div id="tab-staff" class="tab-content">
            <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <h3>Staff Management</h3>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button id="share-invite-qr-btn" class="admin-btn primary small" type="button" onclick="openShareInviteModal()" data-tooltip="Share workspace invite code or scan QR code to pair staff phones">
                        <i data-lucide="qr-code" size="13"></i> Invite Link & QR
                    </button>
                    <button id="export-staff-roster-btn" class="admin-btn secondary small" type="button" onclick="exportStaffRosterCSV()" data-tooltip="Download complete employee directory as CSV">
                        <i data-lucide="download" size="13"></i> Export Roster (CSV)
                    </button>
                    <button id="import-staff-csv-btn" class="admin-btn secondary small" type="button" data-tooltip="Bulk import employees from a CSV file">
                        <i data-lucide="upload" size="13"></i> Import via CSV
                    </button>
                </div>
            </div>
            <div class="staff-manager">
                <input id="staff-admin-search" type="text" placeholder="Search staff by name..." style="width:100%; padding:9px 13px; border-radius:var(--radius); border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:0.86rem; margin-bottom:10px;" />
                <div id="staff-list"><div class="staff-list-state">Loading staff list...</div></div>
                <div class="add-staff-form" style="display:grid; gap:10px; margin-top:14px; padding:14px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface-2);">
                    <div style="font-weight:600; font-size:0.9rem; color:var(--text); margin-bottom:2px;">Add New Staff Member</div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <input id="new-staff-name" type="text" placeholder="Staff Full Name" />
                        <input id="new-staff-dept" type="text" placeholder="Department (e.g. Media, Ops)" />
                    </div>
                    <div style="display:grid; grid-template-columns: 1.3fr 1fr; gap:10px; align-items:center;">
                        <select id="new-staff-policy" style="width:100%; padding:9px 12px; border-radius:6px; border:1px solid var(--border); background:var(--surface); color:var(--text); font-size:0.86rem;">
                            <option value="weekly_hybrid">Hybrid</option>
                            <option value="field_flexible">Flexible / Remote</option>
                            <option value="office_only">On-site Only</option>
                        </select>
                        <div style="display:flex; flex-direction:column; gap:6px;">
                            <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; color:var(--text); cursor:pointer;">
                                <input id="new-staff-lead" type="checkbox" /> Team Lead (Top priority)
                            </label>
                            <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; color:var(--text); cursor:pointer;">
                                <input id="new-staff-report" type="checkbox" checked /> Include in penalty reports
                            </label>
                        </div>
                    </div>
                    <div class="admin-actions compact" style="margin-top:6px; display:flex; flex-wrap:wrap; gap:8px;">
                        <button id="add-staff-btn" class="admin-btn" type="button"><i data-lucide="user-plus" size="13"></i> Add Staff</button>
                        <button id="import-staff-csv-form-btn" class="admin-btn secondary" type="button"><i data-lucide="file-up" size="13"></i> Bulk CSV Import</button>
                        <button id="reset-all-locks-btn" class="admin-btn danger" type="button"><i data-lucide="refresh-cw" size="13"></i> Unlink All Devices</button>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="tab-logs" class="tab-content">
            <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <h3>Attendance Records</h3>
                <button id="export-logs-csv-btn" class="admin-btn secondary small" type="button" onclick="exportFilteredLogsCSV()">
                    <i data-lucide="download" size="13"></i> Export Logs (CSV)
                </button>
            </div>
            <div class="logs-filters">
                <select id="logs-filter-name-select" class="logs-filter-select" aria-label="Filter by name"><option value="">All staff</option></select>
                <div class="date-filter-row">
                    <div class="date-input-wrap">
                        <span class="date-input-label">From:</span>
                        <input id="logs-filter-from" type="date" aria-label="From date" placeholder="From" />
                    </div>
                    <div class="date-input-wrap">
                        <span class="date-input-label">To:</span>
                        <input id="logs-filter-to" type="date" aria-label="To date" placeholder="To" />
                    </div>
                </div>
                <div class="filter-actions">
                    <button id="logs-filter-btn" class="admin-btn secondary small" type="button"><i data-lucide="filter" size="13"></i> Filter</button>
                    <button id="logs-clear-btn" class="admin-btn secondary small" type="button"><i data-lucide="x" size="13"></i> Clear</button>
                </div>
            </div>
            <div id="logs-list"><div class="staff-list-state">Loading records...</div></div>
        </div>
        
        <div id="tab-analytics" class="tab-content">
            <div class="section-header">
                <h3>Attendance Analytics</h3>
                <p class="admin-intro">Hybrid days excluded from attendance rate calculations</p>
            </div>
            <div class="analytics-filter-bar" style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; align-items:center;">
                <button id="analytics-filter-all" class="admin-btn secondary small active" type="button">All Time</button>
                <button id="analytics-filter-month" class="admin-btn secondary small" type="button">This Month</button>
                <button id="analytics-filter-week" class="admin-btn secondary small" type="button">This Week</button>
                <button id="analytics-filter-custom-toggle" class="admin-btn secondary small" type="button">Custom Range</button>
                <div id="analytics-custom-inputs" style="display:none; gap:6px; align-items:center;">
                    <input id="analytics-from-date" type="date" style="padding:4px 8px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:0.8rem;" />
                    <span style="font-size:0.8rem;">to</span>
                    <input id="analytics-to-date" type="date" style="padding:4px 8px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:0.8rem;" />
                    <button id="analytics-apply-custom" class="admin-btn small" type="button">Apply</button>
                </div>
            </div>
            <div id="analytics-content"><div class="staff-list-state">Loading analytics...</div></div>
        </div>
        
        <div id="tab-config" class="tab-content">
            <div class="section-header"><h3>System Configuration</h3><p class="admin-intro">Office location, attendance schedule & geofence settings</p></div>
            
            <div class="config-section-group">
                <h4>Office Location & Geofence</h4>
                <div class="config-cards">
                    <div class="config-card" data-tooltip="Physical GPS latitude coordinate of office premises">
                        <span class="config-icon"><i data-lucide="map-pin" size="18"></i></span>
                        <div class="config-info"><strong>Office Latitude</strong><span class="config-value" id="config-lat-current">6.4518631</span></div>
                        <button id="config-office-lat-btn" class="admin-btn secondary small" type="button" data-tooltip="Edit office latitude">Edit</button>
                    </div>
                    <div class="config-card" data-tooltip="Physical GPS longitude coordinate of office premises">
                        <span class="config-icon"><i data-lucide="map-pin" size="18"></i></span>
                        <div class="config-info"><strong>Office Longitude</strong><span class="config-value" id="config-lon-current">3.5277863</span></div>
                        <button id="config-office-lon-btn" class="admin-btn secondary small" type="button" data-tooltip="Edit office longitude">Edit</button>
                    </div>
                    <div class="config-card" data-tooltip="Allowable GPS radius for verified in-person check-ins">
                        <span class="config-icon"><i data-lucide="target" size="18"></i></span>
                        <div class="config-info"><strong>Geofence Radius</strong><span class="config-value" id="config-radius-current">100 meters</span></div>
                        <button id="config-radius-btn" class="admin-btn secondary small" type="button" data-tooltip="Edit geofence radius in meters">Edit</button>
                    </div>
                </div>
            </div>

            <div class="config-section-group">
                <h4>Attendance Schedule & Policies</h4>
                <div class="config-cards">
                    <div class="config-card" data-tooltip="Primary operating timezone for workday hours, late cutoff, and attendance logs">
                        <span class="config-icon"><i data-lucide="globe" size="18"></i></span>
                        <div class="config-info"><strong>Organization Timezone</strong><span class="config-value" id="config-timezone-current">Africa/Lagos (GMT+1)</span></div>
                        <button id="config-timezone-btn" class="admin-btn secondary small" type="button" data-tooltip="Select organization timezone">Edit</button>
                    </div>
                    <div class="config-card" data-tooltip="Official start of business. Arrivals after this time are flagged as Late">
                        <span class="config-icon"><i data-lucide="clock" size="18"></i></span>
                        <div class="config-info"><strong>Workday Start (Late Cutoff)</strong><span class="config-value" id="config-late-cutoff-current">8:30 AM</span></div>
                        <button id="config-late-cutoff-btn" class="admin-btn secondary small" type="button" data-tooltip="Edit arrival cutoff time">Edit</button>
                    </div>
                    <div class="config-card" data-tooltip="Official office closing time. After this hour, staff who checked in can sign out remotely without office GPS">
                        <span class="config-icon"><i data-lucide="clock-4" size="18"></i></span>
                        <div class="config-info"><strong>Workday Closing Time</strong><span class="config-value" id="config-closing-time-current">5:00 PM</span></div>
                        <button id="config-closing-time-btn" class="admin-btn secondary small" type="button" data-tooltip="Edit office closing hour">Edit</button>
                    </div>
                    <div class="config-card" data-tooltip="When enabled, scheduled Home days count towards attendance percentage; otherwise, quota reflects strictly in-office presence">
                        <span class="config-icon"><i data-lucide="pie-chart" size="18"></i></span>
                        <div class="config-info"><strong>Home Attendance Quota</strong><span class="config-value" id="config-wfh-quota-current">Counted in Quota</span></div>
                        <button id="config-wfh-quota-btn" class="admin-btn secondary small" type="button" data-tooltip="Toggle Home quota contribution">Toggle</button>
                    </div>
                    <div class="config-card" data-tooltip="Official business operating days included in weekly attendance requirements">
                        <span class="config-icon"><i data-lucide="calendar" size="18"></i></span>
                        <div class="config-info"><strong>Working Days</strong><span class="config-value" id="config-workdays-current">Monday – Friday</span></div>
                        <button id="config-workdays-btn" class="admin-btn secondary small" type="button" data-tooltip="Edit active business days">Edit</button>
                    </div>
                    <div class="config-card" data-tooltip="Gives designated team leads priority when reserving limited office slots">
                        <span class="config-icon"><i data-lucide="award" size="18"></i></span>
                        <div class="config-info"><strong>Team Lead Hybrid Priority</strong><span class="config-value" id="config-lead-priority-current">Enabled</span></div>
                        <button id="config-lead-priority-btn" class="admin-btn secondary small" type="button" data-tooltip="Toggle team lead hybrid priority">Toggle</button>
                    </div>
                </div>
            </div>

            <div class="config-section-group">
                <h4>Geofence Calibration Tools</h4>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                    <button id="config-auto-location-btn" class="admin-btn secondary" type="button"><i data-lucide="crosshair" size="14"></i> Set Office to My Current Location</button>
                    <button id="config-test-distance-btn" class="admin-btn secondary" type="button"><i data-lucide="navigation" size="14"></i> Test Current Distance from Office</button>
                </div>
            </div>
        </div>

        <div id="tab-account" class="tab-content">
            <div class="section-header"><h3>Account Settings</h3></div>
            <div class="account-actions">
                <div class="account-card" style="background:rgba(37,99,235,0.06); border-color:rgba(37,99,235,0.25);">
                    <span class="account-icon" style="color:var(--primary);"><i data-lucide="qr-code" size="20"></i></span>
                    <div>
                        <strong>Employee Workspace Pairing & Invite</strong>
                        <p class="admin-intro">Share your 6-character pairing code or QR code with new hires or staff members anytime.</p>
                        <div style="display:flex; gap:10px; margin-top:8px;">
                            <button class="admin-btn primary small" type="button" onclick="openShareInviteModal()">
                                <i data-lucide="share-2" size="13"></i> View Pairing Code & QR
                            </button>
                        </div>
                    </div>
                </div>

                <div class="account-card" style="border:1px solid rgba(16,185,129,0.3); background:rgba(16,185,129,0.05);">
                    <span class="account-icon" style="color:#10b981;"><i data-lucide="credit-card" size="20"></i></span>
                    <div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <strong>Subscription & Commercial Plan</strong>
                            <span class="status-pill-small" style="background:rgba(16,185,129,0.15); color:#059669; font-weight:700;">PRO TRIAL</span>
                        </div>
                        <p class="admin-intro" id="billing-trial-status-text">
                            14-Day Free Trial active. Full access to all features.
                        </p>
                        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;">
                            <button class="admin-btn secondary small" type="button" onclick="openCouponModal()">
                                <i data-lucide="ticket" size="13"></i> Redeem Promo Code
                            </button>
                            <button class="admin-btn primary small" type="button" onclick="showToast('Connecting to billing checkout...', 'info')">
                                <i data-lucide="zap" size="13"></i> Upgrade to Pro ($29/mo)
                            </button>
                        </div>
                    </div>
                </div>

                <div class="account-card">
                    <span class="account-icon"><i data-lucide="key" size="18"></i></span>
                    <div><strong>Change Password</strong><p class="admin-intro">Update your admin password</p></div>
                    <button id="change-password-btn" class="admin-btn secondary small" type="button">Update</button>
                </div>
                <div class="account-card">
                    <span class="account-icon"><i data-lucide="mail" size="18"></i></span>
                    <div>
                        <strong>Recovery Email</strong>
                        <p class="admin-intro" id="recovery-email-display">Active: Loading...</p>
                    </div>
                    <button id="set-recovery-email-btn" class="admin-btn secondary small" type="button">Set / Edit</button>
                </div>
                <div class="account-card">
                    <span class="account-icon"><i data-lucide="log-out" size="18"></i></span>
                    <div><strong>Logout</strong><p class="admin-intro">End your admin session (auto-timeout after 15 min idle)</p></div>
                    <button id="logout-btn" class="admin-btn secondary small danger" type="button">Logout</button>
                </div>

                <div class="account-card" style="border-top: 1px solid var(--border); margin-top: 16px; padding-top: 16px; grid-column: 1 / -1;">
                    <span class="account-icon"><i data-lucide="database" size="18"></i></span>
                    <div>
                        <strong>Data Privacy, Portability & Deletion</strong>
                        <p class="admin-intro">Download complete company data archive or submit an account decommissioning and purge request.</p>
                        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
                            <button type="button" class="admin-btn secondary small" onclick="exportFullTenantArchive()">
                                <i data-lucide="download" size="13"></i> Download Company Data (JSON)
                            </button>
                            <button type="button" class="admin-btn secondary small danger" onclick="requestWorkspaceDeletion()">
                                <i data-lucide="alert-triangle" size="13"></i> Request Account Deletion
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.getElementById('refresh-today-btn').addEventListener('click', async (e) => {
        const btn = e.target.closest('button') || e.target;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '⏳';
        await loadWeekData(false);
        btn.innerHTML = originalHtml;
    });
    document.getElementById('week-prev-btn').addEventListener('click', () => navigateWeek('prev'));
    document.getElementById('week-next-btn').addEventListener('click', () => navigateWeek('next'));
    document.getElementById('dashboard-export-btn').addEventListener('click', async () => {
        const weekData = cachedWeekData[currentWeekStart];
        if (!weekData) { showToast('No week data to export.', 'error'); return; }
        await handleExportWeek(weekData, currentWeekStart);
    });

    document.getElementById('add-staff-btn').addEventListener('click', handleAddStaff);
    document.getElementById('import-staff-csv-btn')?.addEventListener('click', handleImportStaffCsv);
    document.getElementById('import-staff-csv-form-btn')?.addEventListener('click', handleImportStaffCsv);
    document.getElementById('new-staff-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAddStaff(); });
    document.getElementById('reset-all-locks-btn').addEventListener('click', handleResetAllLocks);
    document.getElementById('staff-admin-search')?.addEventListener('input', () => renderStaffList(allStaffList));



    document.getElementById('logs-filter-btn').addEventListener('click', loadLogsViewer);
    document.getElementById('logs-filter-name-select').addEventListener('change', loadLogsViewer);
    document.getElementById('logs-filter-from').addEventListener('change', loadLogsViewer);
    document.getElementById('logs-filter-to').addEventListener('change', loadLogsViewer);
    document.getElementById('logs-clear-btn').addEventListener('click', () => {
        document.getElementById('logs-filter-name-select').value = '';
        document.getElementById('logs-filter-from').value = '';
        document.getElementById('logs-filter-to').value = '';
        loadLogsViewer();
    });

    document.getElementById('change-password-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Change Password',
            message: 'Current password required, then new password.',
            fields: [
                { placeholder: 'Current password', type: 'password', autocomplete: 'current-password' },
                { placeholder: 'New password', type: 'password', autocomplete: 'new-password' }
            ],
            confirmLabel: 'Update'
        });
        if (!result) return;
        try {
            const r = await changeAdminPassword(currentAdminUsername, result[0], result[1]);
            showToast(r.message || 'Password updated.', r.ok ? 'success' : 'error');
        } catch (e) { showToast('Server error.', 'error'); }
    });

    document.getElementById('set-recovery-email-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Set Recovery Email',
            message: 'Password required to confirm identity.',
            fields: [
                { placeholder: 'Current password', type: 'password', autocomplete: 'current-password' },
                { placeholder: 'Recovery email', type: 'email', autocomplete: 'email' }
            ],
            confirmLabel: 'Save'
        });
        if (!result) return;
        try {
            const r = await setRecoveryEmail(currentAdminUsername, result[0], result[1]);
            showToast(r.message || 'Email saved.', r.ok ? 'success' : 'error');
            if (r.ok) loadRecoveryEmailDisplay();
        } catch (e) { showToast('Server error.', 'error'); }
    });

    document.getElementById('add-admin-user-btn')?.addEventListener('click', handleAddAdminUser);

    document.getElementById('analytics-filter-all')?.addEventListener('click', (e) => {
        document.querySelectorAll('.analytics-filter-bar button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById('analytics-custom-inputs').style.display = 'none';
        loadAnalytics('all');
    });
    document.getElementById('analytics-filter-month')?.addEventListener('click', (e) => {
        document.querySelectorAll('.analytics-filter-bar button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById('analytics-custom-inputs').style.display = 'none';
        loadAnalytics('month');
    });
    document.getElementById('analytics-filter-week')?.addEventListener('click', (e) => {
        document.querySelectorAll('.analytics-filter-bar button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById('analytics-custom-inputs').style.display = 'none';
        loadAnalytics('week');
    });
    document.getElementById('analytics-filter-custom-toggle')?.addEventListener('click', (e) => {
        document.querySelectorAll('.analytics-filter-bar button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const customWrap = document.getElementById('analytics-custom-inputs');
        if (customWrap) customWrap.style.display = customWrap.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('analytics-apply-custom')?.addEventListener('click', () => {
        const fromVal = document.getElementById('analytics-from-date')?.value;
        const toVal = document.getElementById('analytics-to-date')?.value;
        if (!fromVal) { showToast('Select a "From" date first.', 'error'); return; }
        loadAnalytics('custom', fromVal, toVal);
    });

    document.getElementById('config-workdays-btn')?.addEventListener('click', async () => {
        const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const startOptions = dayNames.map((d, i) => `<option value="${i}"${i === 0 ? ' selected' : ''}>${d}</option>`).join('');
        const endOptions = dayNames.map((d, i) => `<option value="${i}"${i === 4 ? ' selected' : ''}>${d}</option>`).join('');
        const dialogHtml = `
            <div style="display:flex; flex-direction:column; gap:12px; text-align:left; margin-top:10px;">
                <div style="display:flex; gap:10px; align-items:center;">
                    <label style="font-size:0.82rem; font-weight:600; min-width:50px;">From:</label>
                    <select id="config-workdays-start" style="flex:1; padding:8px 12px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--text);">
                        ${startOptions}
                    </select>
                </div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <label style="font-size:0.82rem; font-weight:600; min-width:50px;">To:</label>
                    <select id="config-workdays-end" style="flex:1; padding:8px 12px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--text);">
                        ${endOptions}
                    </select>
                </div>
            </div>
        `;
        const confirmed = await showInlineDialog({
            title: 'Working Days Schedule',
            message: 'Set the start and end days for office attendance.',
            customContentHtml: dialogHtml,
            confirmLabel: 'Save Schedule'
        });
        if (!confirmed) return;
        const startIdx = window['_dialogVal_config-workdays-start'] || '0';
        const endIdx = window['_dialogVal_config-workdays-end'] || '4';
        delete window['_dialogVal_config-workdays-start'];
        delete window['_dialogVal_config-workdays-end'];
        const displayLabel = `${dayNames[+startIdx]} – ${dayNames[+endIdx]}`;
        const val = `${startIdx}_${endIdx}`;
        try {
            const res = await callBackend({ mode: 'update-config', key: 'WORK_DAYS', value: val });
            showToast(res.message || 'Workdays schedule updated.', res.ok ? 'success' : 'error');
            if (res.ok) document.getElementById('config-workdays-current').textContent = displayLabel;
        } catch (e) { showToast('Server error.', 'error'); }
    });

    loadRecoveryEmailDisplay();
    loadAdminUsersList();

    document.getElementById('logout-btn').addEventListener('click', async () => {
        const confirmed = await confirmDialog('Are you sure you want to logout?', { confirmLabel: 'Logout' });
        if (confirmed) handleLogout(false);
    });

    document.getElementById('config-office-lat-btn').addEventListener('click', async () => {
        const r = await showInlineDialog({ title: 'Office Latitude', fields: [{ placeholder: 'Latitude' }], confirmLabel: 'Update' });
        if (!r) return;
        try { const res = await callBackend({ mode: 'update-config', key: 'OFFICE_LAT', value: r[0] }); showToast(res.message, res.ok ? 'success' : 'error'); if (res.ok) document.getElementById('config-lat-current').textContent = r[0]; } catch (e) { showToast('Server error.', 'error'); }
    });
    document.getElementById('config-office-lon-btn').addEventListener('click', async () => {
        const r = await showInlineDialog({ title: 'Office Longitude', fields: [{ placeholder: 'Longitude' }], confirmLabel: 'Update' });
        if (!r) return;
        try { const res = await callBackend({ mode: 'update-config', key: 'OFFICE_LON', value: r[0] }); showToast(res.message, res.ok ? 'success' : 'error'); if (res.ok) document.getElementById('config-lon-current').textContent = r[0]; } catch (e) { showToast('Server error.', 'error'); }
    });
    document.getElementById('config-radius-btn').addEventListener('click', async () => {
        const r = await showInlineDialog({ title: 'Geofence Radius (10-5000 meters)', fields: [{ placeholder: 'Meters' }], confirmLabel: 'Update' });
        if (!r) return;
        try { const res = await callBackend({ mode: 'update-config', key: 'RADIUS_METERS', value: r[0] }); showToast(res.message, res.ok ? 'success' : 'error'); if (res.ok) document.getElementById('config-radius-current').textContent = r[0] + ' meters'; } catch (e) { showToast('Server error.', 'error'); }
    });
    document.getElementById('config-timezone-btn')?.addEventListener('click', () => {
        openTimezoneModal();
    });

    document.getElementById('config-late-cutoff-btn')?.addEventListener('click', () => {
        openTimePickerModal({
            title: 'Workday Start Time (Late Cutoff)',
            subtitle: 'Sign-ins recorded at or after this time are marked Late.',
            currentMinutes: tenantLateCutoffMinutes,
            mode: 'start',
            onSave: async (totalMinutes) => {
                try {
                    const res = await callBackend({ mode: 'update-config', key: 'LATE_CUTOFF_MINUTES', value: totalMinutes });
                    showToast(res.message || 'Late cutoff time updated.', res.ok ? 'success' : 'error');
                    if (res.ok) {
                        tenantLateCutoffMinutes = totalMinutes;
                        const cutoffEl = document.getElementById('config-late-cutoff-current');
                        if (cutoffEl) cutoffEl.textContent = formatMinutesAsTime(totalMinutes);
                    }
                } catch (e) {
                    showToast('Server error.', 'error');
                }
            }
        });
    });

    document.getElementById('config-lead-priority-btn')?.addEventListener('click', async () => {
        const currentEl = document.getElementById('config-lead-priority-current');
        const isCurrentlyEnabled = currentEl?.textContent.trim() === 'Enabled';
        const nextVal = isCurrentlyEnabled ? 'false' : 'true';
        try {
            const res = await callBackend({ mode: 'update-config', key: 'TEAM_LEAD_PRIORITY_SORT', value: nextVal });
            showToast(`Team Lead Priority ${nextVal === 'true' ? 'Enabled' : 'Disabled'}.`, res.ok ? 'success' : 'error');
            if (res.ok && currentEl) {
                currentEl.textContent = nextVal === 'true' ? 'Enabled' : 'Disabled';
            }
        } catch (e) {
            showToast('Server error.', 'error');
        }
    });

    document.getElementById('config-closing-time-btn')?.addEventListener('click', () => {
        openTimePickerModal({
            title: 'Workday Closing Time',
            subtitle: 'Employees who verified attendance on-site can sign out remotely after this hour without office GPS.',
            currentMinutes: tenantClosingMinutes,
            mode: 'close',
            onSave: async (totalMinutes) => {
                try {
                    const res = await callBackend({ mode: 'update-config', key: 'WORKDAY_END_MINUTES', value: totalMinutes });
                    showToast(res.message || 'Closing time updated.', res.ok ? 'success' : 'error');
                    if (res.ok) {
                        tenantClosingMinutes = totalMinutes;
                        const closingEl = document.getElementById('config-closing-time-current');
                        if (closingEl) closingEl.textContent = formatMinutesAsTime(totalMinutes);
                    }
                } catch (e) {
                    showToast('Server error.', 'error');
                }
            }
        });
    });

    document.getElementById('config-wfh-quota-btn')?.addEventListener('click', async () => {
        const currentEl = document.getElementById('config-wfh-quota-current');
        const isCurrentlyCounted = currentEl?.textContent.trim().includes('Counted');
        const nextVal = isCurrentlyCounted ? 'false' : 'true';
        try {
            const res = await callBackend({ mode: 'update-config', key: 'COUNT_WFH_IN_ATTENDANCE_QUOTA', value: nextVal });
            tenantWfhQuotaEnabled = (nextVal === 'true');
            showToast(`Home Quota Contribution ${nextVal === 'true' ? 'Enabled' : 'Disabled'}.`, res.ok ? 'success' : 'error');
            if (res.ok && currentEl) {
                currentEl.textContent = nextVal === 'true' ? 'Counted in Quota' : 'Office Only';
            }
        } catch (e) { showToast('Server error.', 'error'); }
    });

    document.getElementById('config-auto-location-btn').addEventListener('click', () => {
        if (!navigator.geolocation) {
            showToast('Geolocation is not supported by your browser.', 'error');
            return;
        }
        showToast('Acquiring current GPS location...', 'info');
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude.toFixed(7);
                const lon = pos.coords.longitude.toFixed(7);
                const confirmed = await confirmDialog(
                    `Set office coordinates to your current GPS position?\n\nLatitude: ${lat}\nLongitude: ${lon}`,
                    { confirmLabel: 'Set Coordinates' }
                );
                if (!confirmed) return;
                try {
                    const resLat = await callBackend({ mode: 'update-config', key: 'OFFICE_LAT', value: lat });
                    const resLon = await callBackend({ mode: 'update-config', key: 'OFFICE_LON', value: lon });
                    if (resLat.ok && resLon.ok) {
                        showToast('Office coordinates updated successfully!', 'success');
                        document.getElementById('config-lat-current').textContent = lat;
                        document.getElementById('config-lon-current').textContent = lon;
                    } else {
                        showToast('Failed to update office location.', 'error');
                    }
                } catch (e) {
                    showToast('Server error during update.', 'error');
                }
            },
            (err) => {
                showToast('Could not acquire location: ' + err.message, 'error');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });

    document.getElementById('config-test-distance-btn').addEventListener('click', () => {
        if (!navigator.geolocation) {
            showToast('Geolocation is not supported by your browser.', 'error');
            return;
        }
        const officeLat = parseFloat(document.getElementById('config-lat-current').textContent);
        const officeLon = parseFloat(document.getElementById('config-lon-current').textContent);
        const radiusStr = document.getElementById('config-radius-current').textContent;
        const radius = parseFloat(radiusStr) || 100;

        if (isNaN(officeLat) || isNaN(officeLon)) {
            showToast('Office coordinates are invalid.', 'error');
            return;
        }

        showToast('Acquiring GPS fix for distance test...', 'info');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const curLat = pos.coords.latitude;
                const curLon = pos.coords.longitude;
                const R = 6371e3;
                const dLat = (curLat - officeLat) * Math.PI / 180;
                const dLon = (curLon - officeLon) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(officeLat * Math.PI / 180) * Math.cos(curLat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const dist = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

                const isInside = dist <= radius;
                const statusMsg = isInside ? 'INSIDE GEOFENCE' : 'OUTSIDE GEOFENCE';

                showInlineDialog({
                    title: 'Distance Test Results',
                    message: `Current Position:\nLat: ${curLat.toFixed(6)}, Lon: ${curLon.toFixed(6)}\n\nCalculated Distance: ${dist.toFixed(1)} meters\nGeofence Radius: ${radius} meters\n\nResult: ${statusMsg}`,
                    fields: [],
                    confirmLabel: 'OK'
                });
            },
            (err) => {
                showToast('Could not acquire current location: ' + err.message, 'error');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });

    switchTab('dashboard');
    startAutoRefresh();
    checkTenantTourAutoLaunch();
}

/* ============================================================
   TENANT GUIDED TUTORIAL
   ============================================================ */

let currentTourStep = 0;
const TOTAL_TOUR_STEPS = 5;

function openTenantTourModal(step = 0) {
    const modal = document.getElementById('tenant-guided-tour-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    setTourStep(step);
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function closeTenantTourModal() {
    const modal = document.getElementById('tenant-guided-tour-modal');
    if (modal) modal.style.display = 'none';
    const slug = (currentTenantConfig && currentTenantConfig.slug) || 'default';
    try { localStorage.setItem(`tenant_tour_seen_${slug}`, 'true'); } catch (e) {}
}

function navigateTourStep(direction) {
    const newStep = currentTourStep + direction;
    if (newStep >= TOTAL_TOUR_STEPS) {
        closeTenantTourModal();
        showToast('Guided tour completed! You can reopen it anytime from Quick Guide in the topbar.', 'success');
        return;
    }
    if (newStep < 0) return;
    setTourStep(newStep);
}

function setTourStep(stepIndex) {
    currentTourStep = Math.max(0, Math.min(stepIndex, TOTAL_TOUR_STEPS - 1));
    
    // Update step badge
    const badge = document.getElementById('tour-step-badge');
    if (badge) badge.textContent = `Step ${currentTourStep + 1} of ${TOTAL_TOUR_STEPS}`;

    // Update slides
    const slides = document.querySelectorAll('.tour-slide');
    slides.forEach((slide) => {
        const sIdx = parseInt(slide.dataset.step, 10);
        slide.style.display = sIdx === currentTourStep ? 'block' : 'none';
    });

    // Update dots
    const dots = document.querySelectorAll('.tour-dot');
    dots.forEach((dot) => {
        const dIdx = parseInt(dot.dataset.step, 10);
        if (dIdx === currentTourStep) {
            dot.style.background = 'var(--primary)';
            dot.style.width = '18px';
            dot.style.borderRadius = '6px';
        } else {
            dot.style.background = 'var(--border)';
            dot.style.width = '8px';
            dot.style.borderRadius = '50%';
        }
    });

    // Update buttons
    const prevBtn = document.getElementById('tour-prev-btn');
    const nextBtn = document.getElementById('tour-next-btn');
    if (prevBtn) prevBtn.style.display = currentTourStep === 0 ? 'none' : 'inline-block';
    if (nextBtn) {
        nextBtn.textContent = currentTourStep === TOTAL_TOUR_STEPS - 1 ? 'Finish Guide ✓' : 'Next →';
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function checkTenantTourAutoLaunch() {
    const slug = (currentTenantConfig && currentTenantConfig.slug) || 'default';
    const tourKey = `tenant_tour_seen_${slug}`;
    if (!localStorage.getItem(tourKey)) {
        setTimeout(() => {
            openTenantTourModal(0);
        }, 600);
    }
}

// Expose on window for inline HTML onclick attributes
window.openTenantTourModal = openTenantTourModal;
window.closeTenantTourModal = closeTenantTourModal;
window.navigateTourStep = navigateTourStep;
window.setTourStep = setTourStep;

/* ============================================================
   FORGOT PASSWORD
   ============================================================ */

async function runForgotPasswordFlow() {
    const userStep = await showInlineDialog({ title: 'Forgot Password', message: 'Enter your admin username.', fields: [{ placeholder: 'Username' }], confirmLabel: 'Send Code' });
    if (!userStep) return;
    try {
        const res = await requestPasswordResetCode(userStep[0]);
        showToast(res.message, res.ok ? 'success' : 'error');
        if (!res.ok) return;
    } catch (e) { showToast('Server error.', 'error'); return; }

    const codeStep = await showInlineDialog({ title: 'Enter Reset Code', message: '6-digit code sent to your email.', fields: [{ placeholder: '6-digit code' }, { placeholder: 'New password', type: 'password' }], confirmLabel: 'Reset' });
    if (!codeStep) return;
    try {
        const res = await confirmPasswordReset(userStep[0], codeStep[0], codeStep[1]);
        showToast(res.message, res.ok ? 'success' : 'error');
    } catch (e) { showToast('Server error.', 'error'); }
}

/* ============================================================
   LOGIN
   ============================================================ */

async function checkPendingDeviceTransferRequests() {
    try {
        const response = await callBackend({ mode: 'list-audit-logs', limit: 20 });
        if (!response.ok || !Array.isArray(response.events)) return;

        const pendingRequests = response.events.filter(e => 
            (e.type === 'DEVICE_TRANSFER_REQUEST' || e.action === 'DEVICE_TRANSFER_REQUEST') && e.status === 'PENDING'
        );

        if (!pendingRequests.length) return;

        const req = pendingRequests[0];
        const dialog = document.createElement('div');
        dialog.className = 'dialog-overlay confirm-dialog-overlay active';
        dialog.innerHTML = `
            <div class="dialog-box confirm-dialog-card" style="max-width: 440px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-color, #f8fafc);"><i data-lucide="smartphone" size="18" style="vertical-align:middle; margin-right:6px;"></i> Device Transfer Request</h3>
                    <button id="device-req-close-btn" style="background: none; border: none; color: var(--text-muted, #94a3b8); font-size: 1.2rem; cursor: pointer; padding: 2px 6px;">&times;</button>
                </div>
                <p style="font-size: 0.88rem; color: var(--text-color, #cbd5e1); line-height: 1.5; margin-bottom: 16px;">
                    <strong>${escapeHtml(req.staffName || req.name || 'A staff member')}</strong> has requested to bind their attendance account to a new phone.
                    <br><small style="color: var(--text-muted, #94a3b8);">Requested at: ${escapeHtml(req.time || 'Recently')}</small>
                </p>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="device-req-reject-btn" class="admin-btn secondary small danger" type="button"><i data-lucide="x" size="13" style="vertical-align:middle; margin-right:2px;"></i> Reject</button>
                    <button id="device-req-approve-btn" class="admin-btn small" type="button"><i data-lucide="check" size="13" style="vertical-align:middle; margin-right:2px;"></i> Approve Transfer</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();

        document.getElementById('device-req-close-btn').addEventListener('click', () => dialog.remove());
        
        document.getElementById('device-req-reject-btn').addEventListener('click', async () => {
            showToast('Transfer request rejected.', 'info');
            dialog.remove();
        });

        document.getElementById('device-req-approve-btn').addEventListener('click', async () => {
            try {
                const res = await handleResetStaffLock(req.staffName || req.name);
                showToast('Device transfer approved and device unlinked!', 'success');
            } catch (e) {
                showToast('Could not process approval.', 'error');
            } finally {
                dialog.remove();
            }
        });

    } catch (err) {
        console.warn('Could not check pending device transfer requests:', err);
    }
}

function setLoginLoading(isLoading) {
    const loginBtn = document.getElementById('admin-login-btn');
    const form = document.getElementById('admin-login-form');
    const messageEl = document.getElementById('admin-message');
    if (loginBtn) { 
        loginBtn.disabled = isLoading; 
        loginBtn.innerHTML = isLoading ? '<i data-lucide="loader-2" class="spin" size="14" style="vertical-align:middle; margin-right:4px;"></i> Logging in...' : '<i data-lucide="lock" size="14" style="vertical-align:middle; margin-right:4px;"></i> Log in';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }
    if (form) form.querySelectorAll('input').forEach(i => i.disabled = isLoading);
    if (messageEl && isLoading) { messageEl.textContent = 'Checking admin credentials...'; messageEl.className = 'admin-message'; }
}

async function handleAdminLogin(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const username = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;
    const messageEl = document.getElementById('admin-message');

    if (!username || !password) { messageEl.textContent = 'Username and password are required.'; messageEl.className = 'admin-message error'; return; }

    setLoginLoading(true);
    try {
        const response = await authenticateAdmin(username, password);
        setLoginLoading(false);
        if (response.ok) {
            isAdminLoggedIn = true;
            currentAdminUsername = username;
            safeSession.setItem('admin_session', JSON.stringify({ 
                username, 
                adminToken: response.adminToken || '', 
                csrfToken: response.csrfToken || '', 
                timestamp: Date.now() 
            }));
            if (response.csrfToken) safeSession.setItem('admin_csrf_token', response.csrfToken);
            if (response.adminToken) safeSession.setItem('admin_token', response.adminToken);
            
            // Standard tenant admin logins have role 'admin'. Developer role is only granted if logging in via developer masquerade or explicit operator credentials
            if (response.role === 'developer' && (safeSession.getItem('is_masquerading') === 'true' || safeSession.getItem('developer_operator') === 'true')) {
                safeSession.setItem('is_superuser', 'true');
                safeSession.setItem('admin_role_tier', 'developer');
            } else {
                safeSession.setItem('is_superuser', 'false');
                safeSession.setItem('admin_role_tier', 'admin');
            }
            safeSession.setItem('admin_username', username);
            
            document.getElementById('admin-login-form').style.display = 'none';
            document.getElementById('forgot-password-link').style.display = 'none';
            const hero = document.querySelector('.admin-hero');
            if (hero) hero.style.display = 'none';
            renderAdminPanel();
            checkPendingDeviceTransferRequests();
            resetInactivityTimer();
            
            document.addEventListener('click', resetInactivityTimer);
            document.addEventListener('keydown', resetInactivityTimer);
            document.addEventListener('touchstart', resetInactivityTimer);
        } else {
            messageEl.textContent = response.message || 'Invalid admin credentials.';
            messageEl.className = 'admin-message error';
        }
    } catch (error) {
        setLoginLoading(false);
        messageEl.textContent = 'Could not reach the server.';
        messageEl.className = 'admin-message error';
    }
}

/* ============================================================
   INIT & TENANT BRANDING
   ============================================================ */

let currentTenantConfig = null;

async function initAdminTenantBranding() {
    try {
        currentTenantConfig = await getActiveTenant();
        if (currentTenantConfig) {
            document.title = `${currentTenantConfig.name} - Admin Console`;
            const heroSubtitle = document.querySelector('.admin-hero .admin-intro');
            if (heroSubtitle && currentTenantConfig.name) {
                heroSubtitle.textContent = `Sign in to manage ${currentTenantConfig.name} attendance, staff access, and work schedules.`;
            }
            if (currentTenantConfig.brand_color) {
                document.documentElement.style.setProperty('--primary', currentTenantConfig.brand_color);
            }
        }
    } catch(e) {
        console.warn('initAdminTenantBranding error:', e);
    }
}

async function handleMasqueradeLogin(tokenStr) {
    try {
        const decoded = JSON.parse(atob(tokenStr));
        const { slug, ts, hash } = decoded;
        if (!slug || !ts || !hash) {
            showToast('Invalid operator masquerade token.', 'error');
            return;
        }

        // Freshness: max 10 minutes (600,000 ms)
        if (Math.abs(Date.now() - ts) > 10 * 60 * 1000) {
            showToast('Operator masquerade token expired. Please relaunch from Super Admin.', 'error');
            return;
        }

        // Validate HMAC/Hash against platform master key
        let valid = false;
        try {
            let activeMasterHash = null;
            if (supabaseClient) {
                const { data } = await supabaseClient.from('app_config').select('value').eq('key', 'SUPER_ADMIN_MASTER_KEY_HASH').single();
                if (data && data.value) {
                    activeMasterHash = String(data.value).trim();
                }
            }

            if (activeMasterHash) {
                // If a stored hash is configured in app_config, token MUST match that active hash
                const expectedHash = await sha256Hex(`${slug}:${ts}:${activeMasterHash}`);
                if (hash === expectedHash) {
                    valid = true;
                }
            } else {
                // Only if no custom hash exists in database, fall back to default platform key
                const defaultSecret = 'LifecardMaster2026!';
                const defaultHash = await sha256Hex(defaultSecret);
                const expectedDefaultHash = await sha256Hex(`${slug}:${ts}:${defaultHash}`);
                const expectedDefaultRaw = await sha256Hex(`${slug}:${ts}:${defaultSecret}`);
                if (hash === expectedDefaultHash || hash === expectedDefaultRaw) {
                    valid = true;
                }
            }
        } catch(e) {
            console.error('Masquerade validation error:', e);
        }

        if (!valid) {
            showToast('Invalid operator masquerade token signature.', 'error');
            return;
        }

        // Authenticate session as Developer
        isAdminLoggedIn = true;
        currentAdminUsername = 'Platform Operator (Developer)';
        safeSession.setItem('admin_session', JSON.stringify({
            username: currentAdminUsername,
            adminToken: 'masquerade_operator_token',
            csrfToken: 'masquerade_operator_csrf',
            timestamp: Date.now()
        }));
        safeSession.setItem('admin_token', 'masquerade_operator_token');
        safeSession.setItem('admin_csrf_token', 'masquerade_operator_csrf');
        safeSession.setItem('is_superuser', 'true');
        safeSession.setItem('admin_role_tier', 'developer');
        safeSession.setItem('admin_username', currentAdminUsername);
        safeSession.setItem('is_masquerading', 'true');
        safeSession.setItem('masquerade_tenant', slug);

        // Ensure active tenant is set to slug
        safeStorage.setItem('active_tenant_slug', slug);

        // Clean query params from URL bar immediately without reload
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        const form = document.getElementById('admin-login-form');
        if (form) form.style.display = 'none';
        const forgot = document.getElementById('forgot-password-link');
        if (forgot) forgot.style.display = 'none';
        const hero = document.querySelector('.admin-hero');
        if (hero) hero.style.display = 'none';

        renderAdminPanel();
        showToast(`Developer operator access verified for ${slug}!`, 'success');
        resetInactivityTimer();
        document.addEventListener('click', resetInactivityTimer);
        document.addEventListener('keydown', resetInactivityTimer);
        document.addEventListener('touchstart', resetInactivityTimer);
    } catch(err) {
        console.error('Masquerade login error:', err);
        showToast('Failed to parse operator token.', 'error');
    }
}

function initAdminApp() {
    initTheme();
    initRefreshButton();
    initAllPasswordToggles();
    initAdminTenantBranding();
    document.getElementById('guided-tour-btn')?.addEventListener('click', () => openTenantTourModal(0));

    const urlParams = new URLSearchParams(window.location.search);
    const masqueradeToken = urlParams.get('masquerade');
    if (masqueradeToken) {
        handleMasqueradeLogin(masqueradeToken);
        return;
    }
    
    const savedSession = safeSession.getItem('admin_session');
    if (savedSession) {
        try {
            const session = JSON.parse(savedSession);
            if (session.username && session.timestamp && (Date.now() - session.timestamp < 3600000)) {
                isAdminLoggedIn = true;
                currentAdminUsername = session.username;
                if (session.adminToken) safeSession.setItem('admin_token', session.adminToken);
                if (session.csrfToken) safeSession.setItem('admin_csrf_token', session.csrfToken);
                safeSession.setItem('admin_username', session.username);
                const form = document.getElementById('admin-login-form');
                if (form) form.style.display = 'none';
                const forgot = document.getElementById('forgot-password-link');
                if (forgot) forgot.style.display = 'none';
                const hero = document.querySelector('.admin-hero');
                if (hero) hero.style.display = 'none';
                renderAdminPanel();
                resetInactivityTimer();
                document.addEventListener('click', resetInactivityTimer);
                document.addEventListener('keydown', resetInactivityTimer);
                document.addEventListener('touchstart', resetInactivityTimer);
            } else {
                handleLogout(false);
            }
        } catch (e) { handleLogout(false); }
    }
    
    const form = document.getElementById('admin-login-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            handleAdminLogin(e);
        });
    }
    const loginBtn = document.getElementById('admin-login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleAdminLogin(e);
        });
    }
    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
        forgotLink.addEventListener('click', (e) => { e.preventDefault(); runForgotPasswordFlow(); });
    }

    setTimeout(() => {
        try {
            const overlays = document.querySelectorAll('.dialog-overlay, .session-timeout-overlay, #faq-modal.active');
            if (!overlays || overlays.length === 0) document.body.style.overflow = '';
        } catch (e) {}
    }, 120);
}

/* ============================================================
   SHARE INVITE LINK & QR CODE MODAL
   ============================================================ */

function getTenantPairingDetails() {
    const slug = currentTenantConfig?.slug || (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : 'workspace');
    const code = currentTenantConfig?.workspace_code || currentTenantConfig?.workspaceCode || (typeof generateWorkspaceCode === 'function' ? generateWorkspaceCode(slug) : `${slug.substring(0, 4).toUpperCase()}-26`);
    const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
    const basePath = (typeof window !== 'undefined' && window.location) ? window.location.pathname.replace(/\/admin\/.*$/, '/') : '/';
    const joinUrl = `${origin}${basePath}?join=${encodeURIComponent(code)}`;
    return { slug, code, joinUrl };
}

function openShareInviteModal() {
    const modal = document.getElementById('share-invite-modal');
    const codeEl = document.getElementById('share-modal-code');
    const qrImg = document.getElementById('share-modal-qr-img');
    if (!modal) return;

    const { code, joinUrl } = getTenantPairingDetails();
    if (codeEl) codeEl.textContent = code;
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(joinUrl)}`;
    }
    modal.style.display = 'flex';
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

function closeShareInviteModal() {
    const modal = document.getElementById('share-invite-modal');
    if (modal) modal.style.display = 'none';
}

function copySharePairingCode() {
    const { code } = getTenantPairingDetails();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
            showToast(`Pairing code ${code} copied to clipboard!`, 'success');
        });
    } else {
        showToast(`Pairing code: ${code}`, 'info');
    }
}

function copyShareInviteLink() {
    const { joinUrl } = getTenantPairingDetails();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(joinUrl).then(() => {
            showToast('One-time join link copied to clipboard!', 'success');
        });
    } else {
        showToast(joinUrl, 'info');
    }
}

/* ============================================================
   BILLING & COUPON PROMO REDEMPTION
   ============================================================ */

function openCouponModal() {
    const modal = document.getElementById('billing-coupon-modal');
    const input = document.getElementById('coupon-code-input');
    const msg = document.getElementById('coupon-status-msg');
    if (input) input.value = '';
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    if (modal) modal.style.display = 'flex';
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

function closeCouponModal() {
    const modal = document.getElementById('billing-coupon-modal');
    if (modal) modal.style.display = 'none';
}

async function handleApplyCoupon() {
    const input = document.getElementById('coupon-code-input');
    const msg = document.getElementById('coupon-status-msg');
    const btn = document.getElementById('apply-coupon-btn');
    const code = (input?.value || '').trim().toUpperCase();
    if (!code) {
        if (msg) { msg.style.display = 'block'; msg.style.color = '#ef4444'; msg.textContent = 'Please enter a coupon code.'; }
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }
    try {
        const slug = currentTenantConfig?.slug || (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : 'lifecard');
        const res = await callBackend({ mode: 'apply-coupon', tenantSlug: slug, couponCode: code });
        if (res && res.ok) {
            if (msg) {
                msg.style.display = 'block';
                msg.style.color = '#10b981';
                msg.textContent = res.message || 'Coupon successfully applied!';
            }
            showToast(res.message || 'Coupon successfully applied!', 'success');
            setTimeout(() => {
                closeCouponModal();
                if (currentTenantConfig) {
                    if (res.newTrialEnd) currentTenantConfig.trial_ends_at = res.newTrialEnd;
                    if (res.discountApplied) currentTenantConfig.retention_discount_applied = true;
                }
            }, 1200);
        } else {
            if (msg) {
                msg.style.display = 'block';
                msg.style.color = '#ef4444';
                msg.textContent = res.message || 'Invalid or expired coupon code.';
            }
        }
    } catch(err) {
        if (msg) {
            msg.style.display = 'block';
            msg.style.color = '#ef4444';
            msg.textContent = err.message || 'Failed to apply coupon.';
        }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Apply Code'; }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminApp);
} else {
    initAdminApp();
}
