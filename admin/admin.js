/**
 * Admin console logic.
 * Depends on ../common.js being loaded first.
 * Tabbed interface with Dashboard, Staff, Logs, Analytics, Account, Config
 */

let isAdminLoggedIn = false;
let currentAdminUsername = '';
let currentTab = 'dashboard';
let autoRefreshTimer = null;
let allStaffList = [];
let cachedLogs = [];
let analyticsData = null;

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

async function fetchLogs(filters = {}) {
    return callBackend({ mode: 'list-logs', ...filters });
}

/* ---------- Tab Navigation ---------- */

function switchTab(tabId) {
    currentTab = tabId;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    // Show/hide tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    const activeContent = document.getElementById(`tab-${tabId}`);
    if (activeContent) activeContent.classList.add('active');
    
    // Load tab data on demand
    if (tabId === 'dashboard') loadDashboard();
    else if (tabId === 'staff') loadStaffManagement();
    else if (tabId === 'logs') loadLogsViewer();
    else if (tabId === 'analytics') loadAnalytics();
    
    // Clear auto-refresh, set for dashboard
    clearAutoRefresh();
    if (tabId === 'dashboard') startAutoRefresh();
}

function clearAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
}

function startAutoRefresh(intervalMs = 300000) { // 5 minutes
    if (autoRefreshTimer) clearAutoRefresh();
    autoRefreshTimer = setInterval(() => {
        if (currentTab === 'dashboard') {
            loadDashboard(true); // silent refresh
        }
    }, intervalMs);
}

/* ---------- Helper Functions ---------- */

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

function getTodayDateString() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function isoDateToDdMmYyyy(isoDate) {
    if (!isoDate) return '';
    const [yyyy, mm, dd] = isoDate.split('-');
    if (!yyyy || !mm || !dd) return '';
    return `${dd}/${mm}/${yyyy}`;
}

function formatTime12h(timeStr) {
    if (!timeStr) return '';
    // Already formatted as hh:mm AM/PM
    return timeStr;
}

/* ---------- Export Functions ---------- */

function exportToCSV(data, filename) {
    if (!data || !data.length) {
        showToast('No data to export.', 'error');
        return;
    }
    
    // Build CSV string
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header] || '';
                return `"${String(value).replace(/"/g, '""')}"`;
            }).join(',')
        )
    ];
    const csvString = csvRows.join('\n');
    
    // Download
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${getTodayDateString().replace(/\//g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    showToast(`Exported ${data.length} records.`, 'success');
}

/* ============================================================
   DASHBOARD TAB
   ============================================================ */

function renderTodayAttendance(logs, isSilent = false) {
    const host = document.getElementById('today-attendance-list');
    if (!host) return;
    
    const dashboardContainer = document.getElementById('dashboard-container');
    
    if (!logs || !logs.length) {
        if (!isSilent) host.innerHTML = '<div class="staff-list-state">No attendance records for today.</div>';
        return;
    }

    // Group by staff name to show latest status
    const staffStatus = {};
    logs.forEach(entry => {
        const name = entry.name;
        if (!staffStatus[name] || new Date(entry.time) > new Date(staffStatus[name].time)) {
            staffStatus[name] = entry;
        }
    });

    const sortedStaff = Object.values(staffStatus).sort((a, b) => 
        a.name.localeCompare(b.name)
    );
    
    const signedIn = sortedStaff.filter(s => s.action === 'IN').length;
    const signedOut = sortedStaff.filter(s => s.action === 'OUT').length;

    host.innerHTML = `
        <div class="today-attendance-summary">
            <div class="summary-stat-card">
                <span class="stat-number">${sortedStaff.length}</span>
                <span class="stat-label">Total Today</span>
            </div>
            <div class="summary-stat-card signed-in-bg">
                <span class="stat-number">${signedIn}</span>
                <span class="stat-label">Signed In</span>
            </div>
            <div class="summary-stat-card signed-out-bg">
                <span class="stat-number">${signedOut}</span>
                <span class="stat-label">Signed Out</span>
            </div>
        </div>
        <div class="today-attendance-list">
            ${sortedStaff.map(entry => `
                <div class="today-attendance-row ${entry.action === 'IN' ? 'signed-in' : 'signed-out'}">
                    <span class="staff-name">${escapeHtml(entry.name)}</span>
                    <span class="attendance-time">${escapeHtml(entry.time)}</span>
                    <span class="attendance-status ${entry.action === 'IN' ? 'status-in' : 'status-out'}">
                        ${entry.action === 'IN' ? '✓ Signed In' : '✓ Signed Out'}
                    </span>
                </div>
            `).join('')}
        </div>
    `;
    
    // Update last refreshed time
    const refreshLabel = document.getElementById('refresh-label');
    if (refreshLabel) refreshLabel.textContent = `Auto-refreshes every 5 min · Last: ${new Date().toLocaleTimeString()}`;
}

async function loadDashboard(isSilent = false) {
    const host = document.getElementById('today-attendance-list');
    if (!host) return;
    if (!isSilent) host.innerHTML = '<div class="staff-list-state">Loading today\'s attendance...</div>';
    
    const today = getTodayDateString();
    
    try {
        const response = await fetchLogs({
            fromDate: today,
            toDate: today,
            limit: 500
        });
        
        if (response.ok && Array.isArray(response.logs)) {
            cachedLogs = response.logs;
            renderTodayAttendance(response.logs, isSilent);
        } else {
            if (!isSilent) host.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'Could not load today\'s attendance.')}</div>`;
        }
    } catch (error) {
        if (!isSilent) host.innerHTML = '<div class="staff-list-state">Failed to reach the server. Check your connection and retry.</div>';
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
            <div class="staff-actions">
                <button class="admin-btn secondary small" type="button" data-reset-name="${escapeHtml(entry.name)}" title="Reset device lock">Reset</button>
                <button class="admin-btn secondary small danger" type="button" data-remove-name="${escapeHtml(entry.name)}" title="Remove staff">Remove</button>
            </div>
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
            // Update staff filter dropdowns
            populateStaffFilterDropdowns(response.staff);
        } else {
            if (staffList) staffList.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'Could not load staff list.')}</div>`;
        }
    } catch (error) {
        if (staffList) staffList.innerHTML = '<div class="staff-list-state">Failed to reach the server. Check your connection and retry.</div>';
    }
}

function populateStaffFilterDropdowns(staff) {
    // Populate logs filter dropdown
    const filterSelect = document.getElementById('logs-filter-name-select');
    const todayFilterSelect = document.getElementById('today-filter-name');
    
    if (filterSelect) {
        const currentVal = filterSelect.value;
        filterSelect.innerHTML = '<option value="">All staff</option>' +
            staff.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
        if (currentVal) filterSelect.value = currentVal;
    }
    
    if (todayFilterSelect) {
        const currentVal = todayFilterSelect.value;
        todayFilterSelect.innerHTML = '<option value="">All staff</option>' +
            staff.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
        if (currentVal) todayFilterSelect.value = currentVal;
    }
}

async function handleAddStaff() {
    const input = document.getElementById('new-staff-name');
    const name = input.value.trim();
    
    if (!name) {
        showToast('Enter a staff name first.', 'error');
        return;
    }
    if (name.length < 2) {
        showToast('Staff name must be at least 2 characters.', 'error');
        return;
    }
    if (name.length > 50) {
        showToast('Staff name must be less than 50 characters.', 'error');
        return;
    }
    if (!/^[a-zA-Z\s\-'.]+$/.test(name)) {
        showToast('Staff name can only contain letters, spaces, hyphens, and apostrophes.', 'error');
        return;
    }
    
    const addBtn = document.getElementById('add-staff-btn');
    addBtn.disabled = true;
    try {
        const response = await addStaff(name);
        showToast(response.message || 'Staff action completed.', response.ok ? 'success' : 'error');
        if (response.ok) {
            input.value = '';
            await loadStaffList();
        }
    } catch (error) {
        showToast('Could not reach the server.', 'error');
    } finally {
        addBtn.disabled = false;
    }
}

async function handleRemoveStaff(name) {
    const confirmed = await confirmDialog(`Remove ${name} from the staff list? This cannot be undone.`, { danger: true, confirmLabel: 'Remove' });
    if (!confirmed) return;
    try {
        const response = await removeStaffRecord(name);
        showToast(response.message || 'Staff removed.', response.ok ? 'success' : 'error');
        if (response.ok) await loadStaffList();
    } catch (error) {
        showToast('Could not reach the server.', 'error');
    }
}

async function handleResetStaffLock(name) {
    const confirmed = await confirmDialog(`Reset the device lock for ${name}? They will be able to register a new device on next sign-in.`, { confirmLabel: 'Reset lock' });
    if (!confirmed) return;
    try {
        const response = await resetStaffLock(name);
        showToast(response.message || 'Staff lock reset.', response.ok ? 'success' : 'error');
        if (response.ok) await loadStaffList();
    } catch (error) {
        showToast('Could not reach the server.', 'error');
    }
}

/* ============================================================
   LOGS VIEWER TAB
   ============================================================ */

function renderLogsTable(logs) {
    const host = document.getElementById('logs-list');
    if (!host) return;
    if (!logs.length) {
        host.innerHTML = '<div class="staff-list-state">No attendance records match this filter.</div>';
        return;
    }
    cachedLogs = logs;
    
    host.innerHTML = `
        <div class="logs-table-wrapper">
            <div class="logs-table">
                <div class="logs-row logs-head">
                    <span>Date</span><span>Name</span><span>Action</span><span>Time</span><span>Status</span><span>Dist</span>
                </div>
                ${logs.map((entry) => `
                    <div class="logs-row">
                        <span>${escapeHtml(entry.date)}</span>
                        <span>${escapeHtml(entry.name)}</span>
                        <span class="logs-action ${entry.action === 'IN' ? 'in' : 'out'}">${escapeHtml(entry.action)}</span>
                        <span>${escapeHtml(entry.time)}</span>
                        <span><span class="status-pill-small ${entry.status?.toLowerCase() === 'verified' ? 'synced' : 'offline'}">${escapeHtml(entry.status)}</span></span>
                        <span>${escapeHtml(entry.distance || '-')}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="logs-footer">
            <span>Showing ${logs.length} record${logs.length !== 1 ? 's' : ''}</span>
            <button id="export-logs-btn" class="admin-btn secondary small" type="button">📥 Export CSV</button>
        </div>
    `;
    
    document.getElementById('export-logs-btn').addEventListener('click', () => {
        exportToCSV(logs, 'attendance_logs');
    });
}

async function loadLogsViewer() {
    const host = document.getElementById('logs-list');
    if (host) host.innerHTML = '<div class="staff-list-state">Loading attendance records...</div>';

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
            renderLogsTable(response.logs);
        } else {
            if (host) host.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'Could not load attendance records.')}</div>`;
        }
    } catch (error) {
        if (host) host.innerHTML = '<div class="staff-list-state">Failed to reach the server. Check your connection and retry.</div>';
    }
}

/* ============================================================
   ANALYTICS TAB
   ============================================================ */

function processAnalyticsData(logs) {
    if (!logs || !logs.length) return null;
    
    // Staff breakdown
    const staffCounts = {};
    const staffActions = {};
    let lateCount = 0;
    let earlyOutCount = 0;
    let totalDays = new Set();
    
    logs.forEach(entry => {
        const name = entry.name;
        if (!staffCounts[name]) staffCounts[name] = { in: 0, out: 0, late: 0, earlyOut: 0 };
        if (entry.action === 'IN') staffCounts[name].in++;
        if (entry.action === 'OUT') staffCounts[name].out++;
        if (entry.status === 'LATE') {
            lateCount++;
            if (entry.action === 'IN') staffCounts[name].late++;
        }
        if (entry.status === 'LATE' && entry.action === 'OUT') {
            earlyOutCount++;
            staffCounts[name].earlyOut++;
        }
        if (entry.date) totalDays.add(entry.date);
    });
    
    return {
        totalEntries: logs.length,
        uniqueStaff: Object.keys(staffCounts).length,
        totalDays: totalDays.size,
        lateCount,
        earlyOutCount,
        latePercentage: logs.length ? ((lateCount / logs.length) * 100).toFixed(1) : 0,
        staffBreakdown: Object.entries(staffCounts)
            .map(([name, counts]) => ({ name, ...counts }))
            .sort((a, b) => (b.in + b.out) - (a.in + a.out))
    };
}

function renderAnalytics() {
    const host = document.getElementById('analytics-content');
    if (!host) return;
    
    if (!analyticsData) {
        host.innerHTML = '<div class="staff-list-state">No data available for analytics.</div>';
        return;
    }
    
    const data = analyticsData;
    
    host.innerHTML = `
        <div class="analytics-grid">
            <div class="analytics-card">
                <span class="analytics-icon">📊</span>
                <div class="analytics-stat">
                    <span class="analytics-number">${data.totalEntries}</span>
                    <span class="analytics-label">Total Records</span>
                </div>
            </div>
            <div class="analytics-card">
                <span class="analytics-icon">👥</span>
                <div class="analytics-stat">
                    <span class="analytics-number">${data.uniqueStaff}</span>
                    <span class="analytics-label">Staff Members</span>
                </div>
            </div>
            <div class="analytics-card">
                <span class="analytics-icon">📅</span>
                <div class="analytics-stat">
                    <span class="analytics-number">${data.totalDays}</span>
                    <span class="analytics-label">Active Days</span>
                </div>
            </div>
            <div class="analytics-card ${data.latePercentage > 20 ? 'warning' : 'ok'}">
                <span class="analytics-icon">⏰</span>
                <div class="analytics-stat">
                    <span class="analytics-number">${data.lateCount}</span>
                    <span class="analytics-label">Late Arrivals (${data.latePercentage}%)</span>
                </div>
            </div>
        </div>
        
        <div class="analytics-section">
            <h4>Staff Activity Breakdown</h4>
            <div class="analytics-breakdown">
                ${data.staffBreakdown.map(s => `
                    <div class="breakdown-row">
                        <span class="breakdown-name">${escapeHtml(s.name)}</span>
                        <span class="breakdown-bar">
                            <span class="bar-in" style="width: ${Math.min(100, (s.in / Math.max(...data.staffBreakdown.map(x => x.in)) * 100))}%"></span>
                        </span>
                        <span class="breakdown-stats">
                            <span class="stat-in">${s.in} in</span>
                            <span class="stat-out">${s.out} out</span>
                            ${s.late > 0 ? `<span class="stat-late">⚠ ${s.late} late</span>` : ''}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="logs-footer">
            <button id="export-analytics-btn" class="admin-btn secondary small" type="button">📥 Export Analytics CSV</button>
        </div>
    `;
    
    document.getElementById('export-analytics-btn').addEventListener('click', () => {
        const exportData = data.staffBreakdown.map(s => ({
            Name: s.name,
            'Sign Ins': s.in,
            'Sign Outs': s.out,
            'Late Arrivals': s.late,
            'Early Departures': s.earlyOut
        }));
        exportToCSV(exportData, 'attendance_analytics');
    });
}

async function loadAnalytics() {
    const host = document.getElementById('analytics-content');
    if (host) host.innerHTML = '<div class="staff-list-state">Loading analytics...</div>';
    
    // Fetch a broader range of logs for analytics
    try {
        const response = await fetchLogs({ limit: 1000 });
        if (response.ok && Array.isArray(response.logs)) {
            analyticsData = processAnalyticsData(response.logs);
            renderAnalytics();
        } else {
            if (host) host.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'Could not load analytics.')}</div>`;
        }
    } catch (error) {
        if (host) host.innerHTML = '<div class="staff-list-state">Failed to reach the server. Check your connection and retry.</div>';
    }
}

/* ============================================================
   LOAD ALL TABS ON INIT
   ============================================================ */

function loadStaffManagement() {
    loadStaffList();
}

/* ============================================================
   RENDER PANEL
   ============================================================ */

function renderAdminPanel() {
    const panelHost = document.getElementById('admin-panel-host');
    panelHost.innerHTML = `
        <!-- Tab Navigation -->
        <div class="admin-tabs">
            <button class="tab-btn active" data-tab="dashboard" title="Dashboard">
                <span class="tab-icon">📊</span>
                <span class="tab-label">Dashboard</span>
            </button>
            <button class="tab-btn" data-tab="staff" title="Staff">
                <span class="tab-icon">👥</span>
                <span class="tab-label">Staff</span>
            </button>
            <button class="tab-btn" data-tab="logs" title="Logs">
                <span class="tab-icon">📋</span>
                <span class="tab-label">Logs</span>
            </button>
            <button class="tab-btn" data-tab="analytics" title="Analytics">
                <span class="tab-icon">📈</span>
                <span class="tab-label">Analytics</span>
            </button>
            <button class="tab-btn" data-tab="account" title="Account">
                <span class="tab-icon">🔐</span>
                <span class="tab-label">Account</span>
            </button>
            <button class="tab-btn" data-tab="config" title="Config">
                <span class="tab-icon">⚙️</span>
                <span class="tab-label">Config</span>
            </button>
        </div>
        
        <!-- Dashboard Tab -->
        <div id="tab-dashboard" class="tab-content active">
            <div class="dashboard-header">
                <h3>Today's Attendance</h3>
                <div class="dashboard-actions">
                    <span id="refresh-label" class="refresh-label">Auto-refreshes every 5 min</span>
                    <button id="refresh-today-btn" class="admin-btn secondary small" type="button">🔄 Refresh</button>
                </div>
            </div>
            <div id="today-attendance-list">
                <div class="staff-list-state">Loading today's attendance...</div>
            </div>
            <div class="dashboard-quick-actions">
                <button id="dashboard-export-btn" class="admin-btn secondary small" type="button">📥 Export Today</button>
                <a class="admin-btn secondary small" href="../index.html" style="text-decoration:none;">← Back to Sign In</a>
            </div>
        </div>
        
        <!-- Staff Management Tab -->
        <div id="tab-staff" class="tab-content">
            <div class="section-header">
                <h3>Staff Management</h3>
            </div>
            <div class="staff-manager">
                <div id="staff-list"><div class="staff-list-state">Loading staff list...</div></div>
                <div class="add-staff-form">
                    <input id="new-staff-name" type="text" placeholder="Enter staff name to add" />
                    <div class="admin-actions compact">
                        <button id="add-staff-btn" class="admin-btn" type="button">➕ Add Staff</button>
                        <button id="reset-device-btn" class="admin-btn secondary" type="button">🔄 Reassign Device</button>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Logs Viewer Tab -->
        <div id="tab-logs" class="tab-content">
            <div class="section-header">
                <h3>Attendance Records</h3>
            </div>
            <div class="logs-filters">
                <select id="logs-filter-name-select" aria-label="Filter by staff name">
                    <option value="">All staff</option>
                </select>
                <input id="logs-filter-from" type="date" aria-label="From date" />
                <input id="logs-filter-to" type="date" aria-label="To date" />
                <div class="filter-actions">
                    <button id="logs-filter-btn" class="admin-btn secondary small" type="button">🔍 Filter</button>
                    <button id="logs-clear-btn" class="admin-btn secondary small" type="button">✕ Clear</button>
                </div>
            </div>
            <div id="logs-list"><div class="staff-list-state">Loading attendance records...</div></div>
        </div>
        
        <!-- Analytics Tab -->
        <div id="tab-analytics" class="tab-content">
            <div class="section-header">
                <h3>Attendance Analytics</h3>
                <p class="admin-intro">Overview of attendance patterns and staff activity</p>
            </div>
            <div id="analytics-content">
                <div class="staff-list-state">Loading analytics...</div>
            </div>
        </div>
        
        <!-- Account Tab -->
        <div id="tab-account" class="tab-content">
            <div class="section-header">
                <h3>Account Settings</h3>
            </div>
            <div class="account-actions">
                <div class="account-card">
                    <span class="account-icon">🔑</span>
                    <div>
                        <strong>Change Password</strong>
                        <p class="admin-intro">Update your admin password</p>
                    </div>
                    <button id="change-password-btn" class="admin-btn secondary small" type="button">Update</button>
                </div>
                <div class="account-card">
                    <span class="account-icon">📧</span>
                    <div>
                        <strong>Recovery Email</strong>
                        <p class="admin-intro">Set email for password recovery</p>
                    </div>
                    <button id="set-recovery-email-btn" class="admin-btn secondary small" type="button">Set</button>
                </div>
                <div class="account-card">
                    <span class="account-icon">🚪</span>
                    <div>
                        <strong>Logout</strong>
                        <p class="admin-intro">End your admin session</p>
                    </div>
                    <button id="logout-btn" class="admin-btn secondary small danger" type="button">Logout</button>
                </div>
            </div>
        </div>
        
        <!-- Configuration Tab -->
        <div id="tab-config" class="tab-content">
            <div class="section-header">
                <h3>System Configuration</h3>
                <p class="admin-intro">These settings control office location, allowed distance, and timezone</p>
            </div>
            <div class="config-cards">
                <div class="config-card">
                    <span class="config-icon">📍</span>
                    <div class="config-info">
                        <strong>Office Latitude</strong>
                        <span class="config-value" id="config-lat-current">6.4518631</span>
                    </div>
                    <button id="config-office-lat-btn" class="admin-btn secondary small" type="button">Edit</button>
                </div>
                <div class="config-card">
                    <span class="config-icon">📍</span>
                    <div class="config-info">
                        <strong>Office Longitude</strong>
                        <span class="config-value" id="config-lon-current">3.5277863</span>
                    </div>
                    <button id="config-office-lon-btn" class="admin-btn secondary small" type="button">Edit</button>
                </div>
                <div class="config-card">
                    <span class="config-icon">📏</span>
                    <div class="config-info">
                        <strong>Geofence Radius</strong>
                        <span class="config-value" id="config-radius-current">200m</span>
                    </div>
                    <button id="config-radius-btn" class="admin-btn secondary small" type="button">Edit</button>
                </div>
                <div class="config-card">
                    <span class="config-icon">🕐</span>
                    <div class="config-info">
                        <strong>Timezone</strong>
                        <span class="config-value" id="config-tz-current">GMT+1</span>
                    </div>
                    <button id="config-timezone-btn" class="admin-btn secondary small" type="button">Edit</button>
                </div>
            </div>
        </div>
    `;

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Dashboard events
    document.getElementById('refresh-today-btn').addEventListener('click', () => loadDashboard(false));
    document.getElementById('dashboard-export-btn').addEventListener('click', () => {
        if (cachedLogs && cachedLogs.length) {
            exportToCSV(cachedLogs, 'today_attendance');
        } else {
            showToast('No attendance data to export.', 'error');
        }
    });

    // Staff events
    document.getElementById('add-staff-btn').addEventListener('click', handleAddStaff);
    document.getElementById('new-staff-name').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') handleAddStaff();
    });

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
            message: 'Enter your current password to confirm, then your new password.',
            fields: [
                { placeholder: 'Current password', type: 'password', autocomplete: 'current-password' },
                { placeholder: 'New password', type: 'password', autocomplete: 'new-password' }
            ],
            confirmLabel: 'Update Password'
        });
        if (!result) return;
        const [currentPassword, newPassword] = result;
        try {
            const response = await changeAdminPassword(currentAdminUsername, currentPassword, newPassword);
            showToast(response.message || 'Password change request completed.', response.ok ? 'success' : 'error');
        } catch (error) {
            showToast('Could not reach the server.', 'error');
        }
    });

    document.getElementById('set-recovery-email-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Set Recovery Email',
            message: 'This email will receive a code if you need to reset a forgotten password.',
            fields: [
                { placeholder: 'Current password', type: 'password', autocomplete: 'current-password' },
                { placeholder: 'Recovery email', type: 'email', autocomplete: 'email' }
            ],
            confirmLabel: 'Save Email'
        });
        if (!result) return;
        const [currentPassword, email] = result;
        try {
            const response = await setRecoveryEmail(currentAdminUsername, currentPassword, email);
            showToast(response.message || 'Recovery email request completed.', response.ok ? 'success' : 'error');
        } catch (error) {
            showToast('Could not reach the server.', 'error');
        }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        const confirmed = await confirmDialog('Are you sure you want to logout?', { confirmLabel: 'Logout' });
        if (confirmed) {
            sessionStorage.removeItem('admin_session');
            isAdminLoggedIn = false;
            currentAdminUsername = '';
            clearAutoRefresh();
            document.getElementById('admin-panel-host').innerHTML = '';
            document.getElementById('admin-login-form').style.display = 'grid';
            document.getElementById('forgot-password-link').style.display = 'block';
        }
    });

    // Config events
    document.getElementById('config-office-lat-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Update Office Latitude',
            message: 'Enter the office latitude coordinate (e.g., 6.4518631).',
            fields: [{ placeholder: 'Latitude', type: 'text', autocomplete: 'off' }],
            confirmLabel: 'Update'
        });
        if (!result) return;
        const [lat] = result;
        try {
            const response = await callBackend({ mode: 'update-config', key: 'OFFICE_LAT', value: lat });
            showToast(response.message || 'Configuration updated.', response.ok ? 'success' : 'error');
            if (response.ok) document.getElementById('config-lat-current').textContent = lat;
        } catch (error) {
            showToast('Could not reach the server.', 'error');
        }
    });

    document.getElementById('config-office-lon-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Update Office Longitude',
            message: 'Enter the office longitude coordinate (e.g., 3.5277863).',
            fields: [{ placeholder: 'Longitude', type: 'text', autocomplete: 'off' }],
            confirmLabel: 'Update'
        });
        if (!result) return;
        const [lon] = result;
        try {
            const response = await callBackend({ mode: 'update-config', key: 'OFFICE_LON', value: lon });
            showToast(response.message || 'Configuration updated.', response.ok ? 'success' : 'error');
            if (response.ok) document.getElementById('config-lon-current').textContent = lon;
        } catch (error) {
            showToast('Could not reach the server.', 'error');
        }
    });

    document.getElementById('config-radius-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Update Geofence Radius',
            message: 'Enter the allowed distance from office in meters (10-5000).',
            fields: [{ placeholder: 'Radius in meters', type: 'text', autocomplete: 'off' }],
            confirmLabel: 'Update'
        });
        if (!result) return;
        const [radius] = result;
        try {
            const response = await callBackend({ mode: 'update-config', key: 'RADIUS_METERS', value: radius });
            showToast(response.message || 'Configuration updated.', response.ok ? 'success' : 'error');
            if (response.ok) document.getElementById('config-radius-current').textContent = radius + 'm';
        } catch (error) {
            showToast('Could not reach the server.', 'error');
        }
    });

    document.getElementById('config-timezone-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Update Timezone',
            message: 'Enter the timezone (e.g., GMT+1, GMT-5).',
            fields: [{ placeholder: 'Timezone', type: 'text', autocomplete: 'off' }],
            confirmLabel: 'Update'
        });
        if (!result) return;
        const [tz] = result;
        try {
            const response = await callBackend({ mode: 'update-config', key: 'TIMEZONE', value: tz });
            showToast(response.message || 'Configuration updated.', response.ok ? 'success' : 'error');
            if (response.ok) document.getElementById('config-tz-current').textContent = tz;
        } catch (error) {
            showToast('Could not reach the server.', 'error');
        }
    });

    // Load dashboard by default
    switchTab('dashboard');
}

/* ============================================================
   FORGOT PASSWORD FLOW
   ============================================================ */

async function runForgotPasswordFlow() {
    const usernameStep = await showInlineDialog({
        title: 'Forgot Password',
        message: 'Enter your admin username. If a recovery email is on file, a 6-digit code will be sent to it.',
        fields: [{ placeholder: 'Username', type: 'text', autocomplete: 'username' }],
        confirmLabel: 'Send Code'
    });
    if (!usernameStep) return;
    const username = usernameStep[0];

    try {
        const requestResponse = await requestPasswordResetCode(username);
        showToast(requestResponse.message || 'Check your email for a code.', requestResponse.ok ? 'success' : 'error');
        if (!requestResponse.ok) return;
    } catch (error) {
        showToast('Could not reach the server.', 'error');
        return;
    }

    const confirmStep = await showInlineDialog({
        title: 'Enter Reset Code',
        message: 'Enter the 6-digit code emailed to you, then choose a new password.',
        fields: [
            { placeholder: '6-digit code', type: 'text', autocomplete: 'one-time-code' },
            { placeholder: 'New password', type: 'password', autocomplete: 'new-password' }
        ],
        confirmLabel: 'Reset Password'
    });
    if (!confirmStep) return;
    const [code, newPassword] = confirmStep;

    try {
        const confirmResponse = await confirmPasswordReset(username, code, newPassword);
        showToast(confirmResponse.message || 'Password reset request completed.', confirmResponse.ok ? 'success' : 'error');
    } catch (error) {
        showToast('Could not reach the server.', 'error');
    }
}

/* ============================================================
   LOGIN FLOW
   ============================================================ */

function setLoginLoading(isLoading) {
    const loginBtn = document.getElementById('admin-login-btn');
    const form = document.getElementById('admin-login-form');
    const messageEl = document.getElementById('admin-message');
    if (loginBtn) {
        loginBtn.disabled = isLoading;
        loginBtn.textContent = isLoading ? '⏳ Logging in...' : '🔐 Log in';
    }
    if (form) {
        form.querySelectorAll('input').forEach((input) => { input.disabled = isLoading; });
    }
    if (messageEl && isLoading) {
        messageEl.textContent = 'Checking admin credentials...';
        messageEl.className = 'admin-message';
    }
}

async function handleAdminLogin(event) {
    if (event) event.preventDefault();
    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value;
    const messageEl = document.getElementById('admin-message');

    if (!username || !password) {
        messageEl.textContent = 'Username and password are required.';
        messageEl.className = 'admin-message error';
        return;
    }

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
            document.querySelector('.admin-hero').style.display = 'none';
            renderAdminPanel();
        } else {
            messageEl.textContent = response.message || 'Invalid admin credentials.';
            messageEl.className = 'admin-message error';
        }
    } catch (error) {
        setLoginLoading(false);
        messageEl.textContent = 'Could not reach the server. Check your connection.';
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
    
    // Check if user is already logged in
    const savedAdminSession = sessionStorage.getItem('admin_session');
    if (savedAdminSession) {
        try {
            const session = JSON.parse(savedAdminSession);
            if (session.username && session.timestamp && (Date.now() - session.timestamp < 3600000)) {
                isAdminLoggedIn = true;
                currentAdminUsername = session.username;
                document.getElementById('admin-login-form').style.display = 'none';
                document.getElementById('forgot-password-link').style.display = 'none';
                document.querySelector('.admin-hero').style.display = 'none';
                renderAdminPanel();
            } else {
                sessionStorage.removeItem('admin_session');
            }
        } catch (e) {
            sessionStorage.removeItem('admin_session');
        }
    }
    
    document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);

    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
        forgotLink.addEventListener('click', (event) => {
            event.preventDefault();
            runForgotPasswordFlow();
        });
    }
});