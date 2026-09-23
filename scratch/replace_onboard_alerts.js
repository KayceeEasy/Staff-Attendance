const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../onboard/onboard.js');
let code = fs.readFileSync(filePath, 'utf8');

const modalDismissalsFn = `
function initOnboardModalDismissals() {
    const modals = [
        { id: 'email-verify-modal', closeFn: closeEmailVerifyModal },
        { id: 'qr-modal', closeFn: closeQrModal }
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

if (!code.includes('function initOnboardModalDismissals')) {
    code = modalDismissalsFn + '\n' + code;
}

const replacements = [
    { from: "alert('Please select a valid image file (PNG, JPG, or SVG).');", to: "showToast('Please select a valid image file (PNG, JPG, or SVG).', 'warning');" },
    { from: "alert('File size exceeds 2MB limit. Please choose a smaller logo.');", to: "showToast('File size exceeds 2MB limit. Please choose a smaller logo.', 'warning');" },
    { from: "if (!name) { alert('Please enter the Company Legal Name.'); return; }", to: "if (!name) { showToast('Please enter the Company Legal Name.', 'warning'); return; }" },
    { from: "if (!slug) { alert('Please enter a Workspace Identifier.'); return; }", to: "if (!slug) { showToast('Please enter a Workspace Identifier.', 'warning'); return; }" },
    { from: "alert(val.message);", to: "showToast(val.message, 'warning');" },
    { from: "alert(`The workspace identifier \"${slug}\" is already in use or reserved. Please choose another identifier.`);", to: "showToast(`The workspace identifier \"${slug}\" is already in use or reserved. Please choose another identifier.`, 'warning');" },
    { from: "if (!office) { alert('Please enter the Office / Branch Name.'); return; }", to: "if (!office) { showToast('Please enter the Office / Branch Name.', 'warning'); return; }" },
    { from: "if (!lat || isNaN(lat)) { alert('Please provide a valid Latitude coordinate.'); return; }", to: "if (!lat || isNaN(lat)) { showToast('Please provide a valid Latitude coordinate.', 'warning'); return; }" },
    { from: "if (!lon || isNaN(lon)) { alert('Please provide a valid Longitude coordinate.'); return; }", to: "if (!lon || isNaN(lon)) { showToast('Please provide a valid Longitude coordinate.', 'warning'); return; }" },
    { from: "alert('Please enter a valid work email address before continuing.');", to: "showToast('Please enter a valid work email address before continuing.', 'warning');" },
    { from: "alert('Password must be at least 6 characters.');", to: "showToast('Password must be at least 6 characters.', 'warning');" },
    { from: "if (!adminName) { alert('Please provide your full name.'); return; }", to: "if (!adminName) { showToast('Please provide your full name.', 'warning'); return; }" },
    { from: "if (!adminEmail || !EMAIL_REGEX.test(adminEmail)) { alert('Please provide a valid work email address.'); return; }", to: "if (!adminEmail || !EMAIL_REGEX.test(adminEmail)) { showToast('Please provide a valid work email address.', 'warning'); return; }" },
    { from: "if (!adminPass || adminPass.length < 6) { alert('Please enter a secure password (at least 6 characters).'); return; }", to: "if (!adminPass || adminPass.length < 6) { showToast('Please enter a secure password (at least 6 characters).', 'warning'); return; }" },
    { from: "alert(validation.message);", to: "showToast(validation.message, 'warning');" },
    { from: "alert(res.message || 'Failed to create workspace.');", to: "showToast(res.message || 'Failed to create workspace.', 'error');" },
    { from: "alert('An unexpected error occurred while saving your workspace.');", to: "showToast('An unexpected error occurred while saving your workspace.', 'error');" },
    { from: "alert('Copied to clipboard!');", to: "showToast('Copied to clipboard!', 'success');" }
];

replacements.forEach(r => {
    while (code.includes(r.from)) {
        code = code.replace(r.from, r.to);
    }
});

// Ensure initOnboardModalDismissals is called on load
if (!code.includes('initOnboardModalDismissals();')) {
    code = code.replace('document.addEventListener("DOMContentLoaded", () => {', 'document.addEventListener("DOMContentLoaded", () => {\n    if (typeof initTheme === "function") initTheme();\n    initOnboardModalDismissals();');
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('✅ Onboarding alerts and modal dismissals successfully modernized!');
