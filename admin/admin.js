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

// Session timeout (5 min inactivity → 30s countdown)
let inactivityTimer = null;
let sessionCountdownTimer = null;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_COUNTDOWN_MS = 30 * 1000; // 30 seconds

/* ---------- Auth ---------- */

async function authenticateAdmin(username, password) {
    const passwordHash = await sha256Hex(password);
    return callBackend({ mode: 'admin-login', username, passwordHash });
}

async function changeAdminPassword(username, currentPassword, newPassword) {
    const currentPasswordHash = await sha256Hex(currentPassword);
    const newPasswordHash = await sha256Hex(newPassword);
    return callBackend({ mode: 'admin-change-password', username, currentPasswordHash, newPasswordHash });
}

async function setRecoveryEmail(username, currentPassword, email) {
    const currentPasswordHash = await sha256Hex(currentPassword);
    return callBackend({ mode: 'admin-set-recovery-email', username, currentPasswordHash, email });
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
    // Return cached data immediately if available and not forcing refresh
    if (!forceRefresh && hybridScheduleCache[weekStart] && Object.keys(hybridScheduleCache[weekStart]).length) {
        console.debug('Returning cached hybrid schedule for', weekStart);
        return hybridScheduleCache[weekStart];
    }

    try {
        console.debug('Fetching hybrid schedule from server for', weekStart);
        const response = await callBackend({ mode: 'get-hybrid-schedule', weekStart });
        console.debug('get-hybrid-schedule response:', response);
        
        let schedule = null;
        
        // Primary: check standard response format
        if (response && response.ok && response.schedule && Object.keys(response.schedule).length) {
            schedule = response.schedule;
        } else {
            // Fallback: try to locate JSON blob in common properties and parse it
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
                    } catch (e) {
                        // ignore parse error
                    }
                }
            }
        }
        
        // Cache the schedule if we got valid data
        if (schedule && Object.keys(schedule).length) {
            hybridScheduleCache[weekStart] = schedule;
            console.debug('Cached hybrid schedule for', weekStart, 'with', Object.keys(schedule).length, 'staff members');
        } else if (hybridScheduleCache[weekStart]) {
            // If server returned empty but we have cache, keep using cache
            console.debug('Server returned empty schedule, using cached data for', weekStart);
            schedule = hybridScheduleCache[weekStart];
        }
        
        return schedule || {};
    } catch (e) {
        console.warn('Could not fetch hybrid schedule:', e);
        // Return cached data on error if available
        if (hybridScheduleCache[weekStart] && Object.keys(hybridScheduleCache[weekStart]).length) {
            console.debug('Network error, using cached hybrid schedule for', weekStart);
            return hybridScheduleCache[weekStart];
        }
        return {};
    }
}

/* ---------- Session Timeout ---------- */

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    clearTimeout(sessionCountdownTimer);
    
    // Close any existing session dialog
    const existingOverlay = document.querySelector('.session-timeout-overlay');
    if (existingOverlay) existingOverlay.remove();
    
    inactivityTimer = setTimeout(showSessionTimeoutWarning, SESSION_TIMEOUT_MS);
}

function showSessionTimeoutWarning() {
    // Create overlay with countdown
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
            handleLogout(true); // silent logout
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
    const usernameInput = document.getElementById('admin-username');
    const passwordInput = document.getElementById('admin-password');
    const messageEl = document.getElementById('admin-message');

    if (form) {
        form.reset();
    }
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
    sessionStorage.removeItem('admin_session');
    isAdminLoggedIn = false;
    currentAdminUsername = '';
    cachedWeekData = {};
    hybridScheduleCache = {}; // Clear hybrid schedule cache on logout
    clearAdminLoginForm();
    
    // Remove session timeout dialog if present
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
        const diff = mondayDate.getDate() - day + (day === 0 ? -6 : 1); // Monday
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
    
    // Load week data (from cache or server)
    loadWeekData();
}

function parseDmyDate(str) {
    const parts = String(str || '').split('/').map(p => p.trim());
    return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
}

function normalizeDateKey(value) {
    if (!value) return '';
    if (value instanceof Date && !isNaN(value)) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    // Accept dd/mm/yyyy, yyyy-mm-dd, and Date.parse-compatible values.
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
    // Build a mapping of normalized staff name -> original schedule key
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
    else { clearAutoRefresh(); }
    
    resetInactivityTimer();
}

function clearAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
}

function startAutoRefresh(intervalMs = 300000) {
    if (autoRefreshTimer) clearAutoRefresh();
    autoRefreshTimer = setInterval(() => {
        if (currentTab === 'dashboard') {
            // Force refresh to check for updates
            loadWeekData(true);
        }
    }, intervalMs);
}

/* ---------- Helper Functions ---------- */

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

function isoDateToDdMmYyyy(isoDate) {
    if (!isoDate) return '';
    const [yyyy, mm, dd] = isoDate.split('-');
    if (!yyyy || !mm || !dd) return '';
    return `${dd}/${mm}/${yyyy}`;
}

// Converts total minutes-since-midnight (what the backend stores/expects
// for LATE_CUTOFF_MINUTES) into a human-readable "8:30 AM" label for the
// Config tab's display.
function formatMinutesAsTime(totalMinutes) {
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    const period = hh >= 12 ? 'PM' : 'AM';
    const displayHour = hh % 12 === 0 ? 12 : hh % 12;
    return `${displayHour}:${String(mm).padStart(2, '0')} ${period}`;
}

/* ---------- Export Functions ---------- */

function exportToCSV(data, filename) {
    if (!data || !data.length) { showToast('No data to export.', 'error'); return; }
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','),
        ...data.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
    ];
    // Prefix with a UTF-8 BOM so Excel correctly renders non-ASCII
    // characters (e.g. the 🏠 emoji in the matrix export) instead of
    // showing mojibake. Other apps (Google Sheets, Numbers) handle the BOM
    // fine too, so this is safe to apply to every export, not just this one.
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`Exported ${data.length} records.`, 'success');
}

/**
 * Builds one row per staff member with one column per weekday (matrix
 * shape, matching the on-screen Weekly Attendance Matrix) instead of one
 * row per individual sign-in/out action. Reuses the exact same per-cell
 * resolution logic as renderAttendanceMatrix so the export always matches
 * what's shown on screen -- including the 🏠 home emoji for WFH days.
 */
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
            const staffSchedules = scheduleKey ? (schedule[scheduleKey] || []) : [];
            const daySchedule = staffSchedules.find(s => normalizeDateKey(s.date) === dayKey);
            const isWfh = String(daySchedule?.location || '').trim().toLowerCase() === 'home';

            const inLog = dayLogs.find(l => String(l.action || '').trim().toUpperCase() === 'IN');

            let cellText = '\u2014'; // em dash, matches the on-screen "absent" marker
            if (isWfh) {
                cellText = '\ud83c\udfe0 Home';
            } else if (inLog) {
                const isLate = inLog.status && String(inLog.status).trim().toUpperCase() === 'LATE';
                cellText = `\u2713 ${inLog.time || ''}`.trim();
                if (isLate) cellText += ' (Late)';
            }

            row[columnLabel] = cellText;
        });

        return row;
    });

    exportToCSV(rows, 'attendance_matrix_week');
}

/* ============================================================
   DASHBOARD / WEEK DATA
   ============================================================ */

async function loadWeekData(isSilent = false) {
    if (!currentWeekStart) {
        const today = new Date();
        currentWeekStart = formatDateDMY(getMondayFromDate(today));
    }

    // Capture which week THIS call is actually for, right now. currentWeekStart
    // is a mutable global that can change (e.g. the admin clicks Prev/Next
    // again) before this function's async work finishes -- especially the
    // delayed background refresh below. Reading the global again later, once
    // more navigation may have happened, was the actual cause of weeks
    // occasionally showing the wrong/mismatched hybrid data: a background
    // refresh queued for one week could resolve after the admin had already
    // navigated elsewhere, and would then write into -- and re-render --
    // whatever week happened to be current AT THAT LATER MOMENT.
    const weekBeingLoaded = currentWeekStart;

    const { monday, friday } = getWeekRange(parseDmyDate(weekBeingLoaded));
    const mondayStr = formatDateDMY(monday);
    const fridayStr = formatDateDMY(friday);
    
    // Update week header
    const weekLabel = document.getElementById('week-label');
    if (weekLabel) weekLabel.textContent = `📅 ${mondayStr} - ${fridayStr}`;
    
    if (!isSilent) {
        document.getElementById('today-attendance-list').innerHTML = '<div class="staff-list-state">Loading...</div>';
        document.getElementById('attendance-matrix').innerHTML = '<div class="staff-list-state">Loading...</div>';
    }
    
    try {
        // Fetch logs for this week
        const response = await fetchLogs({ weekStart: weekBeingLoaded, limit: 500 });
        let logs = response.ok && Array.isArray(response.logs) ? response.logs : [];
        
        // Fetch hybrid schedule for this week (use cache if available for instant display)
        const schedule = await fetchHybridSchedule(weekBeingLoaded, false);
        
        // Cache
        cachedWeekData[weekBeingLoaded] = { logs, schedule };
        
        // Build week day labels (Mon-Fri)
        const weekDays = [];
        for (let i = 0; i < 5; i++) {
            const day = new Date(monday);
            day.setDate(monday.getDate() + i);
            weekDays.push(formatDateDMY(day));
        }
        
        // Only touch the visible DOM if the admin is still looking at the
        // week this call was for -- if they've since navigated elsewhere,
        // a newer loadWeekData() call already owns the screen.
        if (currentWeekStart === weekBeingLoaded) {
            renderWeekOverview(logs, schedule, weekDays);
            renderAttendanceMatrix(logs, schedule, weekDays);

            const refreshLabel = document.getElementById('refresh-label');
            if (refreshLabel) refreshLabel.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
        
        // Background refresh: fetch fresh schedule data and update if changed
        if (!isSilent && currentTab === 'dashboard') {
            fetchHybridSchedule(weekBeingLoaded, true).then(freshSchedule => {
                if (freshSchedule && Object.keys(freshSchedule).length) {
                    // Check if schedule actually changed
                    const oldSchedule = hybridScheduleCache[weekBeingLoaded];
                    if (JSON.stringify(oldSchedule) !== JSON.stringify(freshSchedule)) {
                        console.debug('Schedule updated, re-rendering matrix');
                        hybridScheduleCache[weekBeingLoaded] = freshSchedule;
                        if (cachedWeekData[weekBeingLoaded]) cachedWeekData[weekBeingLoaded].schedule = freshSchedule;

                        // Same guard as above: only re-render if this is still
                        // the week actually on screen.
                        if (currentWeekStart === weekBeingLoaded) {
                            renderAttendanceMatrix(logs, freshSchedule, weekDays);
                            const refreshLabel = document.getElementById('refresh-label');
                            if (refreshLabel) refreshLabel.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (refreshed)`;
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
    
    if (!logs || !logs.length) {
        host.innerHTML = '<div class="staff-list-state">No attendance records for this week.</div>';
        return;
    }
    
    // Stats
    const signedIn = logs.filter(s => String(s.action || '').trim().toUpperCase() === 'IN').length;
    // Use normalized status detection so variations like "Late", "⚠ Late" or localized text still count
    const lateCount = logs.filter(s => normalizeAttendanceStatus(s.status) === 'late' && String(s.action || '').trim().toUpperCase() === 'IN').length;
    
    host.innerHTML = `
        <div class="today-attendance-summary">
            <div class="summary-stat-card">
                <span class="stat-number">${logs.length}</span>
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
    `;
}

function renderAttendanceMatrix(logs, schedule, weekDays) {
    const host = document.getElementById('attendance-matrix');
    if (!host) return;
    
    // Build staff × day matrix
    const staffMap = {};
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    
    // Initialize all staff from schedule + logs
    const allStaff = new Set();
    
    // Add staff from schedule
    Object.keys(schedule).forEach(name => allStaff.add(name));
    // Add staff from logs
    logs.forEach(entry => allStaff.add(entry.name));
    // Add all staff from full list
    if (allStaffList.length) allStaffList.forEach(s => allStaff.add(s.name));
    
    const sortedStaff = Array.from(allStaff).sort((a, b) => a.localeCompare(b));
    const scheduleNameIndex = buildScheduleNameIndex(schedule);
    
    // Build matrix
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

            // Find the schedule key for this staff (case/whitespace resilient)
            let scheduleKey = scheduleNameIndex[normalizedStaffName] || null;
            // Fallback: try to find a close match among schedule keys (contains/contained)
            if (!scheduleKey) {
                const candidate = Object.keys(schedule || {}).find(k => {
                    const nk = String(k || '').trim().toLowerCase();
                    return nk === normalizedStaffName || nk.includes(normalizedStaffName) || normalizedStaffName.includes(nk);
                });
                if (candidate) scheduleKey = candidate;
            }
            const staffSchedules = scheduleKey ? (schedule[scheduleKey] || []) : [];
            const daySchedule = staffSchedules.find(s => normalizeDateKey(s.date) === dayKey);

            matrix[name][idx] = {
                logs: dayLogs,
                schedule: daySchedule || null,
                isWfh: String(daySchedule?.location || '').trim().toLowerCase() === 'home'
            };
        });
    });
    
    host.innerHTML = `
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

                                // Only the day's SIGN-IN record is shown here (sign-out
                                // time and any "missed" sign-out indicator are still
                                // recorded normally in the Google Sheets backend/Logs
                                // tab -- this view just doesn't surface them, since a
                                // sign-in + lateness is what's actually useful at a
                                // glance here). Previously this picked whichever action
                                // (IN or OUT) was most recent that day, so a completed
                                // day would flip to showing the OUT time instead.
                                const inLog = cell.logs.find(l => String(l.action || '').trim().toUpperCase() === 'IN');

                                let status = '';
                                let statusClass = '';

                                if (cell.isWfh) {
                                    // Render only the home emoji for WFH days (no appended text)
                                    status = '<span class="matrix-home-emoji" aria-label="Home">🏠</span>';
                                    statusClass = 'matrix-wfh';
                                } else if (inLog) {
                                    const isLate = inLog.status && String(inLog.status).trim().toUpperCase() === 'LATE';
                                    status = `✓ In<br>${inLog.time || ''}`;
                                    if (isLate) status += '<br>⚠ Late';
                                    statusClass = 'matrix-in';
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
            <span class="legend-item"><span class="legend-dot matrix-wfh"></span> Home</span>
            <span class="legend-item"><span class="legend-dot matrix-absent"></span> Absent</span>
        </div>
    `;

    // Optional debug output: append schedule-name index and WFH counts when '#debug-schedule' present
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
    if (!staff.length) {
        staffList.innerHTML = '<div class="staff-list-state">No staff yet. Add your first staff member below.</div>';
        return;
    }
    allStaffList = staff;
    
    staffList.innerHTML = staff.map((entry) => `
        <div class="admin-row staff-row">
            <span class="staff-name-cell">${escapeHtml(entry.name)}</span>
            <span class="staff-device-cell">${entry.deviceId ? '🔒 Locked' : '🔓 Unlocked'}</span>
            <button class="admin-btn secondary small danger" type="button" title="Clear device lock for ${escapeHtml(entry.name)}" data-reset-name="${escapeHtml(entry.name)}">Reset</button>
            <button class="admin-btn secondary small danger" type="button" title="Remove ${escapeHtml(entry.name)}" data-remove-name="${escapeHtml(entry.name)}">Remove</button>
        </div>
    `).join('');

    staffList.querySelectorAll('[data-reset-name]').forEach((button) => {
        button.addEventListener('click', () => handleResetStaffLock(button.getAttribute('data-reset-name')));
    });
    staffList.querySelectorAll('[data-remove-name]').forEach((button) => {
        button.addEventListener('click', () => handleRemoveStaff(button.getAttribute('data-remove-name')));
    });
}

async function loadStaffList() {
    const staffList = document.getElementById('staff-list');
    if (staffList) staffList.innerHTML = '<div class="staff-list-state">Loading staff list...</div>';
    try {
        const response = await listStaff();
        if (response.ok && response.staff) {
            renderStaffList(response.staff);
            populateStaffFilterDropdowns(response.staff);
        } else {
            if (staffList) staffList.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'Could not load staff list.')}</div>`;
        }
    } catch (error) {
        if (staffList) staffList.innerHTML = '<div class="staff-list-state">Failed to reach the server.</div>';
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

async function loadLogsViewer() {
    const host = document.getElementById('logs-list');
    if (host) host.innerHTML = '<div class="staff-list-state">Loading records...</div>';

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
            logsCurrentPage = 1; // reset to page 1 whenever the filter/query changes
            renderLogsTable();
        } else {
            logsAllRecords = [];
            if (host) host.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'No records found.')}</div>`;
        }
    } catch (error) {
        logsAllRecords = [];
        if (host) host.innerHTML = '<div class="staff-list-state">Failed to reach the server.</div>';
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

    host.innerHTML = `
        <div class="logs-table-wrapper">
            <div class="logs-table">
                <div class="logs-row logs-head">
                    <span>Date</span><span>Name</span><span>Action</span><span>Time</span><span>Status</span><span>Dist</span>
                </div>
                ${pageLogs.map(entry => `
                    <div class="logs-row">
                        <span>${escapeHtml(entry.date)}</span>
                        <span>${escapeHtml(entry.name)}</span>
                        <span class="logs-action ${entry.action === 'IN' ? 'in' : 'out'}">${escapeHtml(entry.action)}</span>
                        <span>${escapeHtml(entry.time)}</span>
                        <span><span class="status-pill-small ${getStatusBadgeClass(entry.status)}">${escapeHtml(getStatusLabel(entry.status))}</span></span>
                        <span>${escapeHtml(entry.distance || '-')}</span>
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
    // Export always exports ALL currently-filtered records, not just the
    // page currently visible on screen.
    document.getElementById('export-logs-btn')?.addEventListener('click', () => exportToCSV(logs, 'attendance_logs'));
}

/* ============================================================
   ANALYTICS TAB
   ============================================================ */

function processAnalyticsData(logs, schedule) {
    if (!logs || !logs.length) return null;
    
    const staffCounts = {};
    let lateCount = 0, earlyOutCount = 0;
    const totalDays = new Set();
    const weeklyOfficeDays = {}; // track expected office days
    
    logs.forEach(entry => {
        const name = entry.name;
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
    
    // Count WFH days from schedule
    Object.entries(schedule).forEach(([name, days]) => {
        if (!staffCounts[name]) {
            staffCounts[name] = { in: 0, out: 0, late: 0, earlyOut: 0, wfhDays: 0, daysPresent: new Set() };
        }
        days.forEach(d => {
            if (d.location === 'home') staffCounts[name].wfhDays++;
        });
    });
    
    // Calculate expected office days (total days in data - WFH days)
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
        .sort((a, b) => a.totalActions - b.totalActions); // Least active first
    
    return {
        totalEntries: logs.length,
        uniqueStaff: Object.keys(staffCounts).length,
        totalDays: totalDaysInRange,
        lateCount,
        earlyOutCount,
        latePercentage: logs.length ? ((lateCount / logs.length) * 100).toFixed(1) : 0,
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
    
    host.innerHTML = `
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
        
        <!-- Least Active Staff -->
        <div class="analytics-section">
            <h4>⚠ Least Active Staff</h4>
            <p class="admin-intro">Staff with fewest sign-ins. Hybrid days are excluded from attendance requirements.</p>
            <div class="analytics-breakdown">
                ${data.leastActive.map(s => `
                    <div class="breakdown-row">
                        <span class="breakdown-name">${escapeHtml(s.name)}</span>
                        <span class="breakdown-bar"><span class="bar-in" style="width: ${Math.min(100, s.attendanceRate)}%"></span></span>
                        <span class="breakdown-stats">
                            <span class="stat-in">${s.signIns} in</span>
                            <span class="stat-out">${s.signOuts} out</span>
                            <span class="${s.attendanceRate < 60 ? 'stat-late' : 'stat-in'}">${s.attendanceRate}% rate</span>
                            ${s.wfhDays > 0 ? `<span class="stat-wfh">🏠 ${s.wfhDays}</span>` : ''}
                            ${s.lateCount > 0 ? `<span class="stat-late">⚠ ${s.lateCount} late</span>` : ''}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <!-- Most Active Staff -->
        <div class="analytics-section">
            <h4>⭐ Most Active Staff</h4>
            <div class="analytics-breakdown">
                ${data.mostActive.map(s => `
                    <div class="breakdown-row">
                        <span class="breakdown-name">${escapeHtml(s.name)}</span>
                        <span class="breakdown-bar"><span class="bar-in" style="width: ${Math.min(100, s.attendanceRate)}%"></span></span>
                        <span class="breakdown-stats">
                            <span class="stat-in">${s.signIns} in</span>
                            <span class="stat-out">${s.signOuts} out</span>
                            <span class="stat-in">${s.attendanceRate}% rate</span>
                            ${s.lateCount > 0 ? `<span class="stat-late">⚠ ${s.lateCount} late</span>` : ''}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <!-- Full Breakdown -->
        <div class="analytics-section">
            <h4>📋 Full Staff Breakdown</h4>
            <div class="analytics-breakdown">
                ${data.staffBreakdown.map(s => `
                    <div class="breakdown-row">
                        <span class="breakdown-name">${escapeHtml(s.name)}</span>
                        <span class="breakdown-bar"><span class="bar-in" style="width: ${Math.min(100, (s.totalActions / Math.max(...data.staffBreakdown.map(x => x.totalActions)) * 100))}%"></span></span>
                        <span class="breakdown-stats">
                            <span class="stat-in">${s.signIns} in</span>
                            <span class="stat-out">${s.signOuts} out</span>
                            <span class="stat-in">${s.attendanceRate}% office</span>
                            ${s.wfhDays > 0 ? `<span class="stat-wfh">🏠 ${s.wfhDays}</span>` : ''}
                            ${s.lateCount > 0 ? `<span class="stat-late">⚠ ${s.lateCount}</span>` : ''}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="logs-footer">
            <button id="export-analytics-btn" class="admin-btn secondary small" type="button">📥 Export CSV</button>
        </div>
        
        <!-- Device Events: geofence-blocked sign-in attempts (from the Distance
             Alerts sheet, the authoritative record) merged with client-reported
             app errors (from Script Properties, which have no sheet equivalent). -->
        <div class="analytics-section">
            <h4>🔴 Device Events</h4>
            <p class="admin-intro">Geofence-blocked sign-in attempts and client-side app errors reported from staff devices.</p>
            ${deviceEvents.length > 0 ? `
            <div class="logs-table-wrapper">
                <div class="logs-table" style="min-width:400px">
                    <div class="logs-row logs-head" style="grid-template-columns:1fr 1fr 2fr">
                        <span>Time</span><span>Type</span><span>Details</span>
                    </div>
                    ${pageEvents.map(e => `
                        <div class="logs-row" style="grid-template-columns:1fr 1fr 2fr">
                            <span style="font-size:0.75rem">${escapeHtml(e.time || '')}</span>
                            <span class="status-pill-small ${e.type.includes('error') || e.type.includes('geofence') ? 'late' : 'offline'}">${escapeHtml(e.type)}</span>
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
            ` : '<div class="staff-list-state">No device errors or geofence violations reported.</div>'}
        </div>
    `;
    
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

// Parses a date/time pair from either source into a comparable timestamp,
// so geofence alerts (date "dd/MM/yyyy" + time "hh:mm a") and client error
// events (single "dd/MM/yyyy HH:mm:ss" string) can be merged into one
// consistently-sorted, most-recent-first list.
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

async function loadAnalytics() {
    const host = document.getElementById('analytics-content');
    if (host) host.innerHTML = '<div class="staff-list-state">Loading analytics...</div>';
    
    try {
        // Use cached week data first for attendance analytics
        const allLogs = Object.values(cachedWeekData).flatMap(w => w.logs || []);
        const allSchedule = Object.values(cachedWeekData).reduce((acc, w) => ({ ...acc, ...(w.schedule || {}) }), {});
        
        // Fetch server-side analytics events AND geofence alerts in parallel
        const [attendanceLogs, analyticsResponse, alertsResponse] = await Promise.all([
            allLogs.length > 0
                ? Promise.resolve(allLogs)
                : fetchLogs({ limit: 1000 }).then(r => (r.ok && Array.isArray(r.logs)) ? r.logs : []),
            callBackend({ mode: 'list-analytics', limit: 50 }).catch((err) => { console.warn('list-analytics fetch failed:', err); return { ok: false, events: [] }; }),
            fetchDistanceAlerts(100).catch((err) => { console.warn('list-distance-alerts fetch failed:', err); return { ok: false, alerts: [] }; })
        ]);

        analyticsData = processAnalyticsData(attendanceLogs, allSchedule);

        // Client-reported errors (global_error, unhandled_rejection) -- these
        // have no server-side equivalent, so this Script Properties feed is
        // still the only source for them.
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

        // Geofence blocks -- read directly from the Distance Alerts sheet
        // (the authoritative record processAttendance always writes to,
        // regardless of the client's connectivity), rather than relying on
        // the client's separate, less reliable follow-up report of the same
        // event.
        const geofenceEvents = (alertsResponse.ok && Array.isArray(alertsResponse.alerts))
            ? alertsResponse.alerts.map(a => ({
                type: 'geofence_violation',
                details: `${a.name} attempted ${a.action} from ~${a.distance}m away`,
                time: `${a.date} ${a.time}`,
                sortValue: parseEventTimestamp(a.date, a.time)
            }))
            : [];

        deviceEventsAll = [...clientEvents, ...geofenceEvents].sort((a, b) => b.sortValue - a.sortValue);
        deviceEventsPage = 1;

        renderAnalytics();
    } catch (error) {
        if (host) host.innerHTML = '<div class="staff-list-state">Failed to load analytics.</div>';
    }
}

/* ============================================================
   RENDER ADMIN PANEL
   ============================================================ */

function renderAdminPanel() {
    const panelHost = document.getElementById('admin-panel-host');
    panelHost.innerHTML = `
        <!-- Tab Navigation -->
        <div class="admin-tabs">
            <button class="tab-btn active" data-tab="dashboard" title="Dashboard"><span class="tab-icon">📊</span><span class="tab-label">Dashboard</span></button>
            <button class="tab-btn" data-tab="staff" title="Staff"><span class="tab-icon">👥</span><span class="tab-label">Staff</span></button>
            <button class="tab-btn" data-tab="logs" title="Logs"><span class="tab-icon">📋</span><span class="tab-label">Logs</span></button>
            <button class="tab-btn" data-tab="analytics" title="Analytics"><span class="tab-icon">📈</span><span class="tab-label">Analytics</span></button>
            <button class="tab-btn" data-tab="account" title="Account"><span class="tab-icon">🔐</span><span class="tab-label">Account</span></button>
            <button class="tab-btn" data-tab="config" title="Config"><span class="tab-icon">⚙️</span><span class="tab-label">Config</span></button>
        </div>
        
        <!-- Dashboard Tab -->
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
                    <a id="sheets-link-btn" class="icon-btn" href="#" target="_blank" rel="noopener" title="Open Google Sheets backend" aria-label="Open Google Sheets backend">📗</a>
                </div>
            </div>
            <div id="today-attendance-list"><div class="staff-list-state">Loading this week...</div></div>
            <div class="dashboard-section">
                <h4>Weekly Attendance Matrix</h4>
                <div id="attendance-matrix"><div class="staff-list-state">Loading matrix...</div></div>
            </div>
            <div class="dashboard-quick-actions">
                <button id="dashboard-export-btn" class="admin-btn secondary small" type="button">📥 Export Week</button>
                <a class="admin-btn secondary small" href="https://kayceeeasy.github.io/Hybrid-Scheduler/" target="_blank" rel="noopener" style="text-decoration:none;">📅 Hybrid Scheduler</a>
            </div>
        </div>
        
        <!-- Staff Management Tab -->
        <div id="tab-staff" class="tab-content">
            <div class="section-header"><h3>Staff Management</h3></div>
            <div class="staff-manager">
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
        
        <!-- Logs Viewer Tab -->
        <div id="tab-logs" class="tab-content">
            <div class="section-header"><h3>Attendance Records</h3></div>
            <div class="logs-filters">
                <select id="logs-filter-name-select" aria-label="Filter by name"><option value="">All staff</option></select>
                <input id="logs-filter-from" type="date" aria-label="From date" placeholder="From" />
                <input id="logs-filter-to" type="date" aria-label="To date" placeholder="To" />
                <div class="filter-actions">
                    <button id="logs-filter-btn" class="admin-btn secondary small" type="button">🔍 Filter</button>
                    <button id="logs-clear-btn" class="admin-btn secondary small" type="button">✕ Clear</button>
                </div>
            </div>
            <div id="logs-list"><div class="staff-list-state">Loading records...</div></div>
        </div>
        
        <!-- Analytics Tab -->
        <div id="tab-analytics" class="tab-content">
            <div class="section-header"><h3>Attendance Analytics</h3><p class="admin-intro">Hybrid days excluded from attendance rate calculations</p></div>
            <div id="analytics-content"><div class="staff-list-state">Loading analytics...</div></div>
        </div>
        
        <!-- Account Tab -->
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
                    <div><strong>Recovery Email</strong><p class="admin-intro">Set email for password recovery</p></div>
                    <button id="set-recovery-email-btn" class="admin-btn secondary small" type="button">Set</button>
                </div>
                <div class="account-card">
                    <span class="account-icon">🚪</span>
                    <div><strong>Logout</strong><p class="admin-intro">End your admin session (auto-timeout after 5 min)</p></div>
                    <button id="logout-btn" class="admin-btn secondary small danger" type="button">Logout</button>
                </div>
            </div>
        </div>
        
        <!-- Configuration Tab -->
        <div id="tab-config" class="tab-content">
            <div class="section-header"><h3>System Configuration</h3><p class="admin-intro">Office location, geofence, timezone</p></div>
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
                    <div class="config-info"><strong>Geofence Radius</strong><span class="config-value" id="config-radius-current">200m</span></div>
                    <button id="config-radius-btn" class="admin-btn secondary small" type="button">Edit</button>
                </div>
                <div class="config-card">
                    <span class="config-icon">⏰</span>
                    <div class="config-info"><strong>Late Cutoff Time</strong><span class="config-value" id="config-late-cutoff-current">8:30 AM</span></div>
                    <button id="config-late-cutoff-btn" class="admin-btn secondary small" type="button">Edit</button>
                </div>
            </div>
        </div>
    `;

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Dashboard events
    document.getElementById('refresh-today-btn').addEventListener('click', () => loadWeekData(false));
    document.getElementById('week-prev-btn').addEventListener('click', () => navigateWeek('prev'));
    document.getElementById('week-next-btn').addEventListener('click', () => navigateWeek('next'));
    document.getElementById('dashboard-export-btn').addEventListener('click', () => {
        const weekData = cachedWeekData[currentWeekStart];
        if (!weekData) { showToast('No week data to export.', 'error'); return; }
        exportWeekMatrixToCSV(weekData.logs || [], weekData.schedule || {}, currentWeekStart);
    });

    // Staff events
    document.getElementById('add-staff-btn').addEventListener('click', handleAddStaff);
    document.getElementById('new-staff-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAddStaff(); });
    document.getElementById('reset-all-locks-btn').addEventListener('click', handleResetAllLocks);

    // Quick-access link to the Google Sheets backend. Fetched dynamically
    // (rather than hardcoded) so it stays correct even if the underlying
    // sheet is ever recreated/moved. Visible to any admin, but only
    // actually useful to whoever has edit access to the Sheet itself --
    // Google's own permissions gate real access, this is just a shortcut.
    callBackend({ mode: 'get-sheet-url' }).then((res) => {
        const btn = document.getElementById('sheets-link-btn');
        if (btn && res && res.ok && res.url) btn.href = res.url;
    }).catch(() => { /* link just stays inert if this fails */ });

    // Logs events
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

    // Account events
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
        } catch (e) { showToast('Server error.', 'error'); }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        const confirmed = await confirmDialog('Are you sure you want to logout?', { confirmLabel: 'Logout' });
        if (confirmed) handleLogout(false);
    });

    // Config events
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
        const r = await showInlineDialog({ title: 'Geofence Radius (10-5000m)', fields: [{ placeholder: 'Meters' }], confirmLabel: 'Update' });
        if (!r) return;
        try { const res = await callBackend({ mode: 'update-config', key: 'RADIUS_METERS', value: r[0] }); showToast(res.message, res.ok ? 'success' : 'error'); if (res.ok) document.getElementById('config-radius-current').textContent = r[0] + 'm'; } catch (e) { showToast('Server error.', 'error'); }
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

    // Start with dashboard
    switchTab('dashboard');
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

function setLoginLoading(isLoading) {
    const loginBtn = document.getElementById('admin-login-btn');
    const form = document.getElementById('admin-login-form');
    const messageEl = document.getElementById('admin-message');
    if (loginBtn) { loginBtn.disabled = isLoading; loginBtn.textContent = isLoading ? '⏳ Logging in...' : '🔐 Log in'; }
    if (form) form.querySelectorAll('input').forEach(i => i.disabled = isLoading);
    if (messageEl && isLoading) { messageEl.textContent = 'Checking admin credentials...'; messageEl.className = 'admin-message'; }
}

async function handleAdminLogin(event) {
    if (event) event.preventDefault();
    const username = document.getElementById('admin-username').value.trim();
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
            sessionStorage.setItem('admin_session', JSON.stringify({ username, timestamp: Date.now() }));
            document.getElementById('admin-login-form').style.display = 'none';
            document.getElementById('forgot-password-link').style.display = 'none';
            const hero = document.querySelector('.admin-hero');
            if (hero) hero.style.display = 'none';
            renderAdminPanel();
            resetInactivityTimer();
            
            // Global event listeners for activity tracking
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

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initRefreshButton();
    initAllPasswordToggles();
    
    // Check saved session
    const savedSession = sessionStorage.getItem('admin_session');
    if (savedSession) {
        try {
            const session = JSON.parse(savedSession);
            if (session.username && session.timestamp && (Date.now() - session.timestamp < 3600000)) {
                isAdminLoggedIn = true;
                currentAdminUsername = session.username;
                document.getElementById('admin-login-form').style.display = 'none';
                document.getElementById('forgot-password-link').style.display = 'none';
                const hero = document.querySelector('.admin-hero');
                if (hero) hero.style.display = 'none';
                renderAdminPanel();
                resetInactivityTimer();
                document.addEventListener('click', resetInactivityTimer);
                document.addEventListener('keydown', resetInactivityTimer);
                document.addEventListener('touchstart', resetInactivityTimer);
            } else {
                sessionStorage.removeItem('admin_session');
            }
        } catch (e) { sessionStorage.removeItem('admin_session'); }
    }
    
    document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);
    document.getElementById('forgot-password-link').addEventListener('click', (e) => { e.preventDefault(); runForgotPasswordFlow(); });

    // Safety: if page loads with a stray overlay or modal left open, ensure body can scroll when no overlays present
    setTimeout(() => {
        try {
            const overlays = document.querySelectorAll('.dialog-overlay, .session-timeout-overlay, #faq-modal.active');
            if (!overlays || overlays.length === 0) document.body.style.overflow = '';
        } catch (e) {
            // ignore
        }
    }, 120);
});