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

async function addStaff(name) {
    return callBackend({ mode: 'add-staff', name });
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
            <h3>⏰ Are you still there?</h3>
            <p>This session will timeout in <strong id="session-countdown">30</strong> seconds due to inactivity.</p>
            <div class="dialog-actions" style="grid-template-columns: 1fr;">
                <button id="session-here-btn" class="btn-in" type="button">✅ I'm here</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
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
            developer: '👑 Superuser',
            admin: '🏢 Super Admin',
            sub_admin: '🛡️ Sub-Admin',
            team_lead: '👥 Team Lead'
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
                            <button class="admin-btn secondary small" type="button" data-edit-admin-role="${escapeHtml(u.username)}" data-current-role="${escapeHtml(u.role)}" title="Edit Admin">✏️ Edit</button>
                            <button class="admin-btn secondary small" type="button" data-reset-admin-pw="${escapeHtml(u.username)}" title="Reset Password">🔑 Reset PW</button>
                            <button class="admin-btn secondary small danger" type="button" data-remove-admin="${escapeHtml(u.username)}" title="Remove Admin">🗑 Remove</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        container.innerHTML = rowsHtml || '<div class="staff-list-state">No delegated admin users.</div>';
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
                    { value: 'admin', label: '🏢 Super Admin' },
                    { value: 'sub_admin', label: '🛡️ Sub-Admin' },
                    { value: 'team_lead', label: '👥 Team Lead' }
                ];
                if (isSuper) {
                    roleOptions.unshift({ value: 'developer', label: '👑 Developer (Superuser)' });
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

function exportWeekMatrixToCSV(logs, schedule, weekStartStr) {
    const monday = parseDmyDate(weekStartStr);
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

    if (!sortedStaff.length) { showToast('No staff data to export for this week.', 'error'); return; }

    const scheduleNameIndex = buildScheduleNameIndex(schedule);

    const rows = sortedStaff.map(name => {
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
                cellText = inLog.time || 'Present';
                if (isLate) {
                    lateCount++;
                    cellText += ' (Late)';
                }
            } else if (isLeave) {
                leaveCount++;
                cellText = 'Leave';
            } else if (isWfh) {
                wfhCount++;
                cellText = 'WFH';
            } else {
                missedCount++;
                cellText = 'Missed';
            }

            row[columnLabel] = cellText;
        });

        row['Days Present'] = presentCount;
        row['Days Late'] = lateCount;
        row['Days WFH'] = wfhCount;
        row['Days on Leave'] = leaveCount;
        row['Days Missed'] = missedCount;

        return row;
    });

    exportToCSV(rows, 'attendance_matrix_week');
}

function exportWeekMatrixToPDF(logs, schedule, weekStartStr) {
    const monday = parseDmyDate(weekStartStr);
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

    if (!sortedStaff.length) { showToast('No staff data to export.', 'error'); return; }

    const scheduleNameIndex = buildScheduleNameIndex(schedule);

    let tableRowsHtml = '';
    let totalPresent = 0;
    let totalLates = 0;
    let totalWfh = 0;
    let totalLeave = 0;
    let totalMissed = 0;

    sortedStaff.forEach(name => {
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
                if (isLate) {
                    staffLate++;
                    totalLates++;
                    cellContent = `⚠️ ${inLog.time || 'Present'} (Late)`;
                    cellStyle += ' background: #fdf2f2; color: #9b1c1c; font-weight: 500;';
                } else {
                    cellContent = `✓ ${inLog.time || 'Present'}`;
                    cellStyle += ' background: #f8fafc; color: #0f172a;';
                }
            } else if (isLeave) {
                staffLeave++;
                totalLeave++;
                cellContent = '🌴 Leave';
                cellStyle += ' background: #f3e8ff; color: #6b21a8; font-weight: 500;';
            } else if (isWfh) {
                staffWfh++;
                totalWfh++;
                cellContent = '🏠 WFH';
                cellStyle += ' background: #f0fdf4; color: #166534; font-weight: 500;';
            } else {
                staffMissed++;
                totalMissed++;
                cellContent = '❌ Missed';
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
    const attendanceRate = totalWorkingDays > 0 ? Math.round(((totalPresent + totalWfh) / totalWorkingDays) * 100) : 0;
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
                    <div style="font-size: 13px; font-weight: bold; color: #0f172a; padding: 6px 12px; background: #f1f5f9; border-radius: 4px;">📅 Week: ${weekRangeStr}</div>
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
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; background: #dcfce7; color: #166534; width: 6%;">WFH</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; background: #f3e8ff; color: #6b21a8; width: 6%;">Leave</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; background: #fef9c3; color: #854d0e; width: 6%;">Miss</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>
            
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 15px; margin-top: 20px;">
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
                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">Work-From-Home</div>
                    <div style="font-size: 20px; font-weight: bold; color: #0f172a;">${totalWfh} days</div>
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
    
    window.print();
    
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
    if (weekLabel) weekLabel.textContent = `📅 ${mondayStr} - ${fridayStr}`;

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
                                    status = `✓ In<br>${escapeHtml(inLog.time || '')}`;
                                    if (isLate) status += '<br>⚠ Late';
                                    statusClass = isLate ? 'matrix-late' : 'matrix-in';
                                } else if (cell.isLeave) {
                                    status = '<span class="matrix-leave-emoji" aria-label="Leave">🌴</span>';
                                    statusClass = 'matrix-leave';
                                } else if (cell.isWfh) {
                                    status = '<span class="matrix-home-emoji" aria-label="Home">🏠</span>';
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
            <span class="legend-item"><span class="legend-dot matrix-in"></span> Signed In</span>
            <span class="legend-item"><span class="legend-dot matrix-late"></span> Late</span>
            <span class="legend-item"><span class="legend-dot matrix-wfh"></span> Home</span>
            <span class="legend-item"><span class="legend-dot matrix-leave"></span> Leave</span>
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
                '<h4>🧪 Schedule Debug</h4>' +
                '<pre style="max-height:240px;overflow:auto;white-space:pre-wrap">' + escapeHtml(JSON.stringify({ scheduleNameIndex, debugRows }, null, 2)) + '</pre>' +
                '</div>';
            host.innerHTML += debugHtml;
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
            <div>Device Lock</div>
            <div style="text-align: right;">Actions</div>
        </div>
    `;

    const rowsHtml = filteredStaff.map((entry) => {
        const isLocked = Boolean(entry.device_id || entry.deviceId);
        return `
        <div class="staff-row">
            <div class="staff-name-cell">${escapeHtml(entry.name)}</div>
            <div class="staff-device-cell">
                <span class="status-pill-small ${isLocked ? 'late' : 'synced'}">${isLocked ? '🔒 Locked' : '🔓 Unlocked'}</span>
            </div>
            <div class="staff-actions">
                <button class="admin-btn secondary small" type="button" title="Clear device lock for ${escapeHtml(entry.name)}" data-reset-name="${escapeHtml(entry.name)}">🔓 Reset</button>
                <button class="admin-btn secondary small danger" type="button" title="Remove ${escapeHtml(entry.name)}" data-remove-name="${escapeHtml(entry.name)}">🗑 Remove</button>
            </div>
        </div>
    `;}).join('');

    if (!setHtmlIfChanged(staffList, headerHtml + rowsHtml)) return;

    staffList.querySelectorAll('[data-reset-name]').forEach((button) => {
        button.addEventListener('click', () => handleResetStaffLock(button.getAttribute('data-reset-name')));
    });
    staffList.querySelectorAll('[data-remove-name]').forEach((button) => {
        button.addEventListener('click', () => handleRemoveStaff(button.getAttribute('data-remove-name')));
    });
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
    
    const addBtn = document.getElementById('add-staff-btn');
    addBtn.disabled = true;
    try {
        const response = await addStaff(name);
        showToast(response.message || 'Staff added.', response.ok ? 'success' : 'error');
        if (response.ok) { input.value = ''; await loadStaffList(); }
    } catch (error) { showToast('Could not reach the server.', 'error'); }
    finally { addBtn.disabled = false; }
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
    const confirmed = await confirmDialog(`Clear device lock for ${name}? They can register a new device on next sign-in.`, { confirmLabel: 'Reset lock' });
    if (!confirmed) return;
    try {
        const response = await resetStaffLock(name);
        showToast(response.message || 'Lock cleared.', response.ok ? 'success' : 'error');
        if (response.ok) await loadStaffList();
    } catch (error) { showToast('Could not reach the server.', 'error'); }
}

async function handleResetAllLocks() {
    const confirmed = await confirmDialog('Clear device locks for ALL staff? Everyone will need to register a new device on their next sign-in. This cannot be undone.', { danger: true, confirmLabel: 'Reset All' });
    if (!confirmed) return;
    try {
        const response = await resetAllLocks();
        showToast(response.message || 'All locks cleared.', response.ok ? 'success' : 'error');
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
            <button id="export-logs-btn" class="admin-btn secondary small" type="button">📥 Export CSV</button>
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
    const lower = String(name || '').toLowerCase();
    return lower.includes('kenneth') || lower.includes('valentine');
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
                ? Math.round((counts.daysPresent.size / Math.max(totalDaysInRange - counts.wfhDays, 1)) * 100)
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
                <span class="analytics-icon">📊</span>
                <div><span class="analytics-number">${data.totalEntries}</span><span class="analytics-label">Records</span></div>
            </div>
            <div class="analytics-card">
                <span class="analytics-icon">👥</span>
                <div><span class="analytics-number">${data.uniqueStaff}</span><span class="analytics-label">Staff</span></div>
            </div>
            <div class="analytics-card">
                <span class="analytics-icon">📅</span>
                <div><span class="analytics-number">${data.totalDays}</span><span class="analytics-label">Active Days</span></div>
            </div>
            <div class="analytics-card ${data.latePercentage > 20 ? 'warning' : 'ok'}">
                <span class="analytics-icon">⏰</span>
                <div><span class="analytics-number">${data.latePercentage}%</span><span class="analytics-label">Late Rate</span></div>
            </div>
        </div>
        
        <div class="analytics-section">
            <h4>⚠ Least Active Staff</h4>
            <p class="admin-intro">Staff with lowest office attendance rate. Scheduled WFH days are excluded from requirements.</p>
            <div class="analytics-table-wrapper">
                <div class="analytics-table">
                    <div class="breakdown-row breakdown-head">
                        <span>Staff Name</span>
                        <span>Progress</span>
                        <span class="col-center">Sign In</span>
                        <span class="col-center">Sign Out</span>
                        <span class="col-center">Rate</span>
                        <span class="col-center">WFH</span>
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
                            <span class="stat-cell stat-late">${s.lateCount > 0 ? `⚠ ${s.lateCount}` : '-'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <div class="analytics-section">
            <h4>⭐ Most Active Staff</h4>
            <div class="analytics-table-wrapper">
                <div class="analytics-table">
                    <div class="breakdown-row breakdown-head">
                        <span>Staff Name</span>
                        <span>Progress</span>
                        <span class="col-center">Sign In</span>
                        <span class="col-center">Sign Out</span>
                        <span class="col-center">Rate</span>
                        <span class="col-center">WFH</span>
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
                            <span class="stat-cell stat-late">${s.lateCount > 0 ? `⚠ ${s.lateCount}` : '-'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <div class="analytics-section">
            <h4>📋 Full Staff Breakdown</h4>
            <div class="analytics-table-wrapper">
                <div class="analytics-table">
                    <div class="breakdown-row breakdown-head">
                        <span>Staff Name</span>
                        <span>Progress</span>
                        <span class="col-center">Sign In</span>
                        <span class="col-center">Sign Out</span>
                        <span class="col-center">Rate</span>
                        <span class="col-center">WFH</span>
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
                            <span class="stat-cell stat-late">${s.lateCount > 0 ? `⚠ ${s.lateCount}` : '-'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <div class="logs-footer">
            <button id="export-analytics-btn" class="admin-btn secondary small" type="button">📥 Export CSV</button>
        </div>
        
        <div class="analytics-section">
            <h4>🔴 Device & System Audit Events</h4>
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
            'Late': s.lateCount, 'WFH Days': s.wfhDays, 'Attendance Rate': s.attendanceRate + '%'
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
    const badgeMap = { developer: '👑', admin: '🏢', sub_admin: '🛡️', team_lead: '👥' };
    const badgeContainer = document.getElementById('topbar-badge-container');
    if (badgeContainer) {
        badgeContainer.innerHTML = `<span class="admin-badge" title="${roleTier}" style="font-size:1.2rem; cursor:help;">${badgeMap[roleTier] || '🔐'}</span>`;
    }

    panelHost.innerHTML = `
        <div class="admin-tabs">
            <button class="tab-btn active" data-tab="dashboard" title="Dashboard"><span class="tab-icon">📊</span><span class="tab-label">Dashboard</span></button>
            <button class="tab-btn" data-tab="staff" title="Staff"><span class="tab-icon">👥</span><span class="tab-label">Staff</span></button>
            <button class="tab-btn" data-tab="logs" title="Logs"><span class="tab-icon">📋</span><span class="tab-label">Logs</span></button>
            <button class="tab-btn" data-tab="analytics" title="Analytics"><span class="tab-icon">📈</span><span class="tab-label">Analytics</span></button>
            <button class="tab-btn" data-tab="config" title="Config"><span class="tab-icon">⚙️</span><span class="tab-label">Config</span></button>
            <button class="tab-btn" data-tab="account" title="Account"><span class="tab-icon">🔐</span><span class="tab-label">Account</span></button>
        </div>
        
        <div id="tab-dashboard" class="tab-content active">
            <div class="dashboard-header">
                <div class="week-navigator">
                    <button id="week-prev-btn" class="admin-btn secondary small" type="button">‹ Prev</button>
                    <span id="week-label" class="week-label">📅 Loading...</span>
                    <button id="week-next-btn" class="admin-btn secondary small" type="button">Next ›</button>
                </div>
                <div class="dashboard-actions">
                    <span id="refresh-label" class="refresh-label"></span>
                    <button id="refresh-today-btn" class="admin-btn secondary small" type="button">🔄</button>
                </div>
            </div>
            <div id="today-attendance-list"><div class="staff-list-state">Loading this week...</div></div>
            <div class="dashboard-section">
                <h4>Weekly Attendance Matrix</h4>
                <div id="attendance-matrix"><div class="staff-list-state">Loading matrix...</div></div>
            </div>
            <div class="dashboard-quick-actions">
                <button id="dashboard-export-btn" class="admin-btn secondary small" type="button">📥 Export Week</button>
                <a class="admin-btn secondary small" href="../hybrid/?key=admin" target="_blank" rel="noopener" style="text-decoration:none;">📅 Hybrid Scheduler</a>
            </div>
        </div>
        
        <div id="tab-staff" class="tab-content">
            <div class="section-header"><h3>Staff Management</h3></div>
            <div class="staff-manager">
                <input id="staff-admin-search" type="text" placeholder="🔍 Search staff by name..." style="width:100%; padding:9px 13px; border-radius:var(--radius); border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:0.86rem; margin-bottom:10px;" />
                <div id="staff-list"><div class="staff-list-state">Loading staff list...</div></div>
                <div class="add-staff-form">
                    <input id="new-staff-name" type="text" placeholder="Enter staff name to add" />
                    <div class="admin-actions compact">
                        <button id="add-staff-btn" class="admin-btn" type="button">➕ Add Staff</button>
                        <button id="reset-all-locks-btn" class="admin-btn danger" type="button">🔓 Reset All Locks</button>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="tab-logs" class="tab-content">
            <div class="section-header"><h3>Attendance Records</h3></div>
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
                    <button id="logs-filter-btn" class="admin-btn secondary small" type="button">🔍 Filter</button>
                    <button id="logs-clear-btn" class="admin-btn secondary small" type="button">✕ Clear</button>
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
                <button id="analytics-filter-all" class="admin-btn secondary small active" type="button">🌐 All Time</button>
                <button id="analytics-filter-month" class="admin-btn secondary small" type="button">📆 This Month</button>
                <button id="analytics-filter-week" class="admin-btn secondary small" type="button">📅 This Week</button>
                <button id="analytics-filter-custom-toggle" class="admin-btn secondary small" type="button">📅 Custom Range</button>
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
                <h4>📍 Office Location</h4>
                <div class="config-cards">
                    <div class="config-card">
                        <span class="config-icon">📍</span>
                        <div class="config-info"><strong>Office Latitude</strong><span class="config-value" id="config-lat-current">6.4518631</span></div>
                        <button id="config-office-lat-btn" class="admin-btn secondary small" type="button">Edit</button>
                    </div>
                    <div class="config-card">
                        <span class="config-icon">📍</span>
                        <div class="config-info"><strong>Office Longitude</strong><span class="config-value" id="config-lon-current">3.5277863</span></div>
                        <button id="config-office-lon-btn" class="admin-btn secondary small" type="button">Edit</button>
                    </div>
                    <div class="config-card">
                        <span class="config-icon">📏</span>
                        <div class="config-info"><strong>Geofence Radius</strong><span class="config-value" id="config-radius-current">100 meters</span></div>
                        <button id="config-radius-btn" class="admin-btn secondary small" type="button">Edit</button>
                    </div>
                </div>
            </div>

            <div class="config-section-group">
                <h4>⏰ Attendance Schedule</h4>
                <div class="config-cards">
                    <div class="config-card">
                        <span class="config-icon">⏰</span>
                        <div class="config-info"><strong>Late Cutoff Time</strong><span class="config-value" id="config-late-cutoff-current">8:30 AM</span></div>
                        <button id="config-late-cutoff-btn" class="admin-btn secondary small" type="button">Edit</button>
                    </div>
                    <div class="config-card">
                        <span class="config-icon">🗓️</span>
                        <div class="config-info"><strong>Working Days</strong><span class="config-value" id="config-workdays-current">Monday – Friday</span></div>
                        <button id="config-workdays-btn" class="admin-btn secondary small" type="button">Edit</button>
                    </div>
                </div>
            </div>

            <div class="config-section-group">
                <h4>🔧 Tools</h4>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                    <button id="config-auto-location-btn" class="admin-btn secondary" type="button">🎯 Set Office to My Current Location</button>
                    <button id="config-test-distance-btn" class="admin-btn secondary" type="button">📡 Test Current Distance from Office</button>
                </div>
            </div>
        </div>

        <div id="tab-account" class="tab-content">
            <div class="section-header"><h3>Account Settings</h3></div>
            <div class="account-actions">
                <div class="account-card">
                    <span class="account-icon">🔑</span>
                    <div><strong>Change Password</strong><p class="admin-intro">Update your admin password</p></div>
                    <button id="change-password-btn" class="admin-btn secondary small" type="button">Update</button>
                </div>
                <div class="account-card">
                    <span class="account-icon">📧</span>
                    <div>
                        <strong>Recovery Email</strong>
                        <p class="admin-intro" id="recovery-email-display">Active: Loading...</p>
                    </div>
                    <button id="set-recovery-email-btn" class="admin-btn secondary small" type="button">Set / Edit</button>
                </div>
                <div class="account-card">
                    <span class="account-icon">🚪</span>
                    <div><strong>Logout</strong><p class="admin-intro">End your admin session (auto-timeout after 15 min idle)</p></div>
                    <button id="logout-btn" class="admin-btn secondary small danger" type="button">Logout</button>
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
    document.getElementById('config-late-cutoff-btn').addEventListener('click', async () => {
        const r = await showInlineDialog({ title: 'Late Cutoff Time', message: 'Sign-ins at or after this time are marked Late.', fields: [{ placeholder: 'Time', type: 'time' }], confirmLabel: 'Update' });
        if (!r || !r[0]) return;
        const [hh, mm] = r[0].split(':').map(Number);
        if (isNaN(hh) || isNaN(mm)) { showToast('Invalid time.', 'error'); return; }
        const totalMinutes = hh * 60 + mm;
        try {
            const res = await callBackend({ mode: 'update-config', key: 'LATE_CUTOFF_MINUTES', value: totalMinutes });
            showToast(res.message, res.ok ? 'success' : 'error');
            if (res.ok) document.getElementById('config-late-cutoff-current').textContent = formatMinutesAsTime(totalMinutes);
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
                const statusMsg = isInside ? '✅ INSIDE GEOFENCE' : '❌ OUTSIDE GEOFENCE';

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
}

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
                    <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-color, #f8fafc);">📱 Device Transfer Request</h3>
                    <button id="device-req-close-btn" style="background: none; border: none; color: var(--text-muted, #94a3b8); font-size: 1.2rem; cursor: pointer; padding: 2px 6px;">✕</button>
                </div>
                <p style="font-size: 0.88rem; color: var(--text-color, #cbd5e1); line-height: 1.5; margin-bottom: 16px;">
                    <strong>${escapeHtml(req.staffName || req.name || 'A staff member')}</strong> has requested to bind their attendance account to a new phone.
                    <br><small style="color: var(--text-muted, #94a3b8);">Requested at: ${escapeHtml(req.time || 'Recently')}</small>
                </p>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="device-req-reject-btn" class="admin-btn secondary small danger" type="button">❌ Reject</button>
                    <button id="device-req-approve-btn" class="admin-btn small" type="button">✅ Approve Transfer</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        document.getElementById('device-req-close-btn').addEventListener('click', () => dialog.remove());
        
        document.getElementById('device-req-reject-btn').addEventListener('click', async () => {
            showToast('Transfer request rejected.', 'info');
            dialog.remove();
        });

        document.getElementById('device-req-approve-btn').addEventListener('click', async () => {
            try {
                const res = await handleResetStaffLock(req.staffName || req.name);
                showToast('Device transfer approved and lock reset!', 'success');
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
    if (loginBtn) { loginBtn.disabled = isLoading; loginBtn.textContent = isLoading ? '⏳ Logging in...' : '🔐 Log in'; }
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
            
            if (response.role === 'developer') {
                safeSession.setItem('is_superuser', 'true');
                safeSession.setItem('admin_role_tier', 'developer');
            } else {
                safeSession.setItem('is_superuser', 'false');
                safeSession.setItem('admin_role_tier', response.role || 'admin');
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
   INIT
   ============================================================ */

function initAdminApp() {
    initTheme();
    initRefreshButton();
    initAllPasswordToggles();
    
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminApp);
} else {
    initAdminApp();
}
