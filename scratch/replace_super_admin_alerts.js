const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../super-admin/super_admin.js');
let code = fs.readFileSync(filePath, 'utf8');

// Add initSuperAdminModalDismissals
const modalDismissalsFn = `
function initSuperAdminModalDismissals() {
    const modals = [
        { id: 'tenant-master-modal', closeFn: closeTenantMasterModal },
        { id: 'master-key-modal', closeFn: closeMasterKeyModal }
    ];

    modals.forEach(({ id, closeFn }) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', (e) => {
            if (e.target === el) closeFn();
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            modals.forEach(({ id, closeFn }) => {
                const el = document.getElementById(id);
                if (el && el.style.display !== 'none' && el.style.display !== '') {
                    closeFn();
                }
            });
        }
    });
}
`;

if (!code.includes('function initSuperAdminModalDismissals')) {
    code = modalDismissalsFn + '\n' + code;
}

// Map replacements
const replacements = [
    { from: "alert(res.message || 'Failed to update status.');", to: "showToast(res.message || 'Failed to update status.', 'error');" },
    { from: "alert('Please select an image file (PNG, JPG, or SVG).');", to: "showToast('Please select an image file (PNG, JPG, or SVG).', 'warning');" },
    { from: "alert('Company profile updated successfully!');", to: "showToast('Company profile updated successfully!', 'success');" },
    { from: "alert(res.message || 'Failed to update profile.');", to: "showToast(res.message || 'Failed to update profile.', 'error');" },
    { from: "alert('Office policies and geofence saved successfully!');", to: "showToast('Office policies and geofence saved successfully!', 'success');" },
    { from: "alert(res.message || 'Failed to save policies.');", to: "showToast(res.message || 'Failed to save policies.', 'error');" },
    { from: "if (!name) { alert('Please enter employee name.'); return; }", to: "if (!name) { showToast('Please enter employee name.', 'warning'); return; }" },
    { from: "alert(res.message || 'Failed to add staff member.');", to: "showToast(res.message || 'Failed to add staff member.', 'error');" },
    { from: "alert(res.message || 'Failed to unlink device.');", to: "showToast(res.message || 'Failed to unlink device.', 'error');" },
    { from: "alert(res.message || 'Failed to remove staff member.');", to: "showToast(res.message || 'Failed to remove staff member.', 'error');" },
    { from: "if (!newPass) { alert('Please enter a new password.'); return; }", to: "if (!newPass) { showToast('Please enter a new password.', 'warning'); return; }" },
    { from: "alert(res.message);", to: "showToast(res.message || 'Operation successful', 'success');" }, // used in reset pass, trial extend, delete
    { from: "alert(res.message || 'Failed to reset password.');", to: "showToast(res.message || 'Failed to reset password.', 'error');" },
    { from: "alert(res.message || 'Failed to extend trial.');", to: "showToast(res.message || 'Failed to extend trial.', 'error');" },
    { from: "alert('50% Retention Deal applied to this workspace.');", to: "showToast('50% Retention Deal applied to this workspace.', 'success');" },
    { from: "alert(res.message || 'Failed to apply retention deal.');", to: "showToast(res.message || 'Failed to apply retention deal.', 'error');" },
    { from: "alert('Please select a valid .json archive file to restore.');", to: "showToast('Please select a valid .json archive file to restore.', 'warning');" },
    { from: "alert(`Workspace archive successfully restored for ${targetSlug}!`);", to: "showToast(`Workspace archive successfully restored for ${targetSlug}!`, 'success');" },
    { from: "alert(`Restore failed: ${err.message}`);", to: "showToast(`Restore failed: ${err.message}`, 'error');" },
    { from: "alert(res.message || 'Attendance history purged.');", to: "showToast(res.message || 'Attendance history purged.', 'success');" },
    { from: "alert('Confirmation did not match. Workspace was NOT deleted.');", to: "showToast('Confirmation did not match. Workspace was NOT deleted.', 'warning');" },
    { from: "alert(res.message || 'Failed to delete tenant.');", to: "showToast(res.message || 'Failed to delete tenant.', 'error');" }
];

replacements.forEach(r => {
    while (code.includes(r.from)) {
        code = code.replace(r.from, r.to);
    }
});

fs.writeFileSync(filePath, code, 'utf8');
console.log('✅ Super Admin alerts and modal dismissals successfully modernized!');
