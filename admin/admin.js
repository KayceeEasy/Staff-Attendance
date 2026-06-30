/**
 * Admin console logic.
 * Depends on ../common.js being loaded first.
 */

let isAdminLoggedIn = false;
let currentAdminUsername = '';

/* ---------- Auth ---------- */

async function authenticateAdmin(username, password) {
    const passwordHash = await sha256Hex(password);
    return callBackend({ mode: 'admin-login', username, passwordHash });
}

/* In-portal change - requires the current password, used when already logged in. */
async function changeAdminPassword(username, currentPassword, newPassword) {
    const currentPasswordHash = await sha256Hex(currentPassword);
    const newPasswordHash = await sha256Hex(newPassword);
    return callBackend({ mode: 'admin-change-password', username, currentPasswordHash, newPasswordHash });
}

async function setRecoveryEmail(username, currentPassword, email) {
    const currentPasswordHash = await sha256Hex(currentPassword);
    return callBackend({ mode: 'admin-set-recovery-email', username, currentPasswordHash, email });
}

/* Forgot-password - no current password needed, verified by emailed code instead. */
async function requestPasswordResetCode(username) {
    return callBackend({ mode: 'admin-forgot-password-request', username });
}

async function confirmPasswordReset(username, code, newPassword) {
    const newPasswordHash = await sha256Hex(newPassword);
    return callBackend({ mode: 'admin-forgot-password-confirm', username, code, newPasswordHash });
}

/* ---------- Staff management ---------- */

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

/* ---------- Rendering ---------- */

function renderStaffList(staff) {
    const staffList = document.getElementById('staff-list');
    if (!staffList) return;
    if (!staff.length) {
        staffList.innerHTML = '<div class="staff-list-state">No staff yet.</div>';
        return;
    }
    staffList.innerHTML = staff.map((entry) => `
        <div class="admin-row staff-row">
            <span>${escapeHtml(entry.name)}</span>
            <div class="staff-actions">
                <button class="admin-btn secondary small" type="button" data-reset-name="${escapeHtml(entry.name)}">Reset</button>
                <button class="admin-btn secondary small danger" type="button" data-remove-name="${escapeHtml(entry.name)}">Remove</button>
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

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

async function loadStaffList() {
    const staffList = document.getElementById('staff-list');
    if (staffList) staffList.innerHTML = '<div class="staff-list-state">Loading staff list...</div>';
    try {
        const response = await listStaff();
        if (response.ok && response.staff) {
            renderStaffList(response.staff);
        } else {
            if (staffList) staffList.innerHTML = `<div class="staff-list-state">${escapeHtml(response.message || 'Could not load staff list.')}</div>`;
        }
    } catch (error) {
        if (staffList) staffList.innerHTML = '<div class="staff-list-state">Failed to reach the server. Check your connection and retry.</div>';
    }
}

async function handleAddStaff() {
    const input = document.getElementById('new-staff-name');
    const name = input.value.trim();
    if (!name) {
        showToast('Enter a staff name first.', 'error');
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

function renderAdminPanel() {
    const panelHost = document.getElementById('admin-panel-host');
    panelHost.innerHTML = `
        <div class="admin-panel admin-panel-inline">
            <div class="admin-content">
                <div class="staff-manager">
                    <h3>Staff list</h3>
                    <div id="staff-list"><div class="staff-list-state">Loading staff list...</div></div>
                    <input id="new-staff-name" type="text" placeholder="Add staff name" />
                    <div class="admin-actions compact">
                        <button id="add-staff-btn" class="admin-btn" type="button">Add staff</button>
                        <button id="reset-device-btn" class="admin-btn secondary" type="button">Reassign a device</button>
                    </div>
                </div>
                <div class="admin-account-section">
                    <h3>Your account</h3>
                    <div class="admin-actions compact">
                        <button id="change-password-btn" class="admin-btn secondary" type="button">Change password</button>
                        <button id="set-recovery-email-btn" class="admin-btn secondary" type="button">Set recovery email</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    loadStaffList();

    document.getElementById('add-staff-btn').addEventListener('click', handleAddStaff);
    document.getElementById('new-staff-name').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') handleAddStaff();
    });

    document.getElementById('reset-device-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Reassign a device',
            message: 'This requires the device reset code. The device will be unlocked from its current owner and assigned to the staff name you provide.',
            fields: [
                { placeholder: 'Reset code', type: 'password', autocomplete: 'off' },
                { placeholder: 'Staff name to assign', type: 'text' }
            ],
            confirmLabel: 'Reassign'
        });
        if (!result) return;
        const [resetCode, staffName] = result;
        try {
            const resetCodeHash = await sha256Hex(resetCode);
            const response = await callBackend({ mode: 'reassign-owner', name: staffName, resetCodeHash, deviceId: 'admin-console' });
            showToast(response.message || (response.allowed ? 'Device reassigned.' : 'Reassignment failed.'), response.allowed ? 'success' : 'error');
        } catch (error) {
            showToast('Could not reach the server.', 'error');
        }
    });

    document.getElementById('change-password-btn').addEventListener('click', async () => {
        const result = await showInlineDialog({
            title: 'Change password',
            message: 'Enter your current password to confirm, then your new password.',
            fields: [
                { placeholder: 'Current password', type: 'password', autocomplete: 'current-password' },
                { placeholder: 'New password', type: 'password', autocomplete: 'new-password' }
            ],
            confirmLabel: 'Update password'
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
            title: 'Set recovery email',
            message: 'This email will receive a code if you ever need to reset a forgotten password. Requires your current password to confirm.',
            fields: [
                { placeholder: 'Current password', type: 'password', autocomplete: 'current-password' },
                { placeholder: 'Recovery email', type: 'email', autocomplete: 'email' }
            ],
            confirmLabel: 'Save email'
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
}

/* ---------- Forgot password (locked-out flow, no current password needed) ---------- */

async function runForgotPasswordFlow() {
    const usernameStep = await showInlineDialog({
        title: 'Forgot password',
        message: 'Enter your admin username. If a recovery email is on file, a 6-digit code will be sent to it.',
        fields: [{ placeholder: 'Username', type: 'text', autocomplete: 'username' }],
        confirmLabel: 'Send code'
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
        title: 'Enter reset code',
        message: 'Enter the 6-digit code emailed to you, then choose a new password.',
        fields: [
            { placeholder: '6-digit code', type: 'text', autocomplete: 'one-time-code' },
            { placeholder: 'New password', type: 'password', autocomplete: 'new-password' }
        ],
        confirmLabel: 'Reset password'
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

/* ---------- Login flow ---------- */

function setLoginLoading(isLoading) {
    const loginBtn = document.getElementById('admin-login-btn');
    const form = document.getElementById('admin-login-form');
    const messageEl = document.getElementById('admin-message');
    if (loginBtn) {
        loginBtn.disabled = isLoading;
        loginBtn.textContent = isLoading ? 'Checking...' : 'Log in';
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
            document.getElementById('admin-login-form').style.display = 'none';
            document.getElementById('forgot-password-link').style.display = 'none';
            renderAdminPanel();
            messageEl.textContent = response.message || 'Admin access granted.';
            messageEl.className = 'admin-message success';
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

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initRefreshButton();
    initAllPasswordToggles();
    document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);

    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
        forgotLink.addEventListener('click', (event) => {
            event.preventDefault();
            runForgotPasswordFlow();
        });
    }
});
