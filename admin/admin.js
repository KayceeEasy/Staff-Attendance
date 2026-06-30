/**
 * Admin console logic.
 * Depends on ../common.js being loaded first.
 */

let isAdminLoggedIn = false;

/* ---------- Auth ---------- */

async function authenticateAdmin(username, password) {
    const passwordHash = await sha256Hex(password);
    return callBackend({ mode: 'admin-login', username, passwordHash });
}

async function resetAdminPassword(username, currentPassword, newPassword) {
    const currentPasswordHash = await sha256Hex(currentPassword);
    const newPasswordHash = await sha256Hex(newPassword);
    return callBackend({ mode: 'admin-reset-password', username, currentPasswordHash, newPasswordHash });
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
            document.getElementById('admin-login-form').style.display = 'none';
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
    document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);

    document.getElementById('admin-reset-password-btn').addEventListener('click', async () => {
        const messageEl = document.getElementById('admin-message');
        const result = await showInlineDialog({
            title: 'Reset admin password',
            message: 'Enter your current credentials to confirm, then the new password.',
            fields: [
                { placeholder: 'Username', type: 'text', autocomplete: 'username' },
                { placeholder: 'Current password', type: 'password', autocomplete: 'current-password' },
                { placeholder: 'New password', type: 'password', autocomplete: 'new-password' }
            ],
            confirmLabel: 'Update password'
        });
        if (!result) return;
        const [username, currentPassword, newPassword] = result;
        try {
            const response = await resetAdminPassword(username, currentPassword, newPassword);
            messageEl.textContent = response.message || 'Password reset request completed.';
            messageEl.className = response.ok ? 'admin-message success' : 'admin-message error';
        } catch (error) {
            messageEl.textContent = 'Could not reach the server.';
            messageEl.className = 'admin-message error';
        }
    });
});
