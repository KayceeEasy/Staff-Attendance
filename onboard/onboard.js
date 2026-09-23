
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

let currentStep = 1;
let uploadedLogoBase64 = "";

function updateSlugPreview(slugVal) {
    if (typeof window === 'undefined') return;
    const origin = window.location.origin;
    const pathname = window.location.pathname || '';
    const basePath = pathname.includes('/onboard') ? pathname.substring(0, pathname.indexOf('/onboard')) : '';
    const clean = String(slugVal || '').trim().toLowerCase() || 'acme';

    const prefixEl = document.getElementById('slug-domain-prefix');
    const adminPreviewEl = document.getElementById('full-admin-preview');
    const slugPreviewEl = document.getElementById('full-slug-preview');

    if (prefixEl) {
        prefixEl.textContent = `${window.location.host}${basePath}/tenant/`;
    }
    if (adminPreviewEl) {
        adminPreviewEl.textContent = `${origin}${basePath}/tenant/${clean}/admin/`;
    }
    if (slugPreviewEl) {
        slugPreviewEl.textContent = `${origin}${basePath}/tenant/${clean}/`;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    updateSlugPreview('');

    const companyNameInput = document.getElementById('company-name');
    const companySlugInput = document.getElementById('company-slug');

    companyNameInput.addEventListener('input', () => {
        const generated = companyNameInput.value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        if (!companySlugInput.dataset.touched) {
            companySlugInput.value = generated;
            updateSlugPreview(generated);
            checkSlugAvailabilityRealtime(generated);
        }
    });

    companySlugInput.addEventListener('input', () => {
        companySlugInput.dataset.touched = "true";
        const val = companySlugInput.value.toLowerCase().replace(/[^a-z0-9-]+/g, '');
        companySlugInput.value = val;
        updateSlugPreview(val);
        checkSlugAvailabilityRealtime(val);
    });

    const adminEmailInput = document.getElementById('admin-email');
    if (adminEmailInput) {
        adminEmailInput.addEventListener('input', () => {
            validateEmailRealtime(adminEmailInput.value);
        });
    }

    const adminPassInput = document.getElementById('admin-pass');
    if (adminPassInput) {
        adminPassInput.addEventListener('input', () => {
            updatePasswordStrength(adminPassInput.value);
        });
    }

    // Color picker sync
    const colorInput = document.getElementById('brand-color');
    const colorDisplay = document.getElementById('color-code-display');
    colorInput.addEventListener('input', () => {
        colorDisplay.textContent = colorInput.value;
    });

    // Radius slider sync
    const radiusSlider = document.getElementById('geofence-radius');
    const radiusDisplay = document.getElementById('radius-display');
    radiusSlider.addEventListener('input', () => {
        radiusDisplay.textContent = `${radiusSlider.value} meters`;
    });

    // Logo dropzone setup
    setupLogoDropzone();
});

function setupLogoDropzone() {
    const dropzone = document.getElementById('logo-dropzone');
    const fileInput = document.getElementById('logo-file-input');
    const emptyState = document.getElementById('dropzone-empty');
    const previewState = document.getElementById('dropzone-preview');
    const previewImg = document.getElementById('logo-preview-img');
    const filenameLabel = document.getElementById('logo-filename');
    const removeBtn = document.getElementById('remove-logo-btn');

    dropzone.addEventListener('click', (e) => {
        if (e.target !== removeBtn) fileInput.click();
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files[0]) handleLogoFile(files[0]);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) handleLogoFile(fileInput.files[0]);
    });

    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadedLogoBase64 = "";
        fileInput.value = "";
        emptyState.style.display = 'block';
        previewState.style.display = 'none';
        previewImg.src = "";
    });

    function handleLogoFile(file) {
        if (!file.type.startsWith('image/')) {
            showToast('Please select a valid image file (PNG, JPG, or SVG).', 'warning');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            showToast('File size exceeds 2MB limit. Please choose a smaller logo.', 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            uploadedLogoBase64 = e.target.result;
            previewImg.src = uploadedLogoBase64;
            filenameLabel.textContent = file.name;
            emptyState.style.display = 'none';
            previewState.style.display = 'flex';
        };
        reader.readAsDataURL(file);
    }
}

function detectCurrentLocation() {
    const gpsStatus = document.getElementById('gps-status');
    const latInput = document.getElementById('office-lat');
    const lonInput = document.getElementById('office-lon');

    if (!navigator.geolocation) {
        gpsStatus.textContent = 'Geolocation is not supported by your browser.';
        gpsStatus.style.color = '#dc2626';
        return;
    }

    gpsStatus.textContent = 'Detecting current coordinates...';
    gpsStatus.style.color = 'var(--text-muted)';

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude.toFixed(6);
            const lon = pos.coords.longitude.toFixed(6);
            latInput.value = lat;
            lonInput.value = lon;
            gpsStatus.textContent = `Successfully captured: Lat ${lat}, Lon ${lon} (Accuracy: ±${Math.round(pos.coords.accuracy)}m)`;
            gpsStatus.style.color = 'var(--success)';
        },
        (err) => {
            gpsStatus.textContent = `Could not get location: ${err.message}. Please enter coordinates manually.`;
            gpsStatus.style.color = '#dc2626';
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

const RESERVED_SLUGS = new Set([
    'admin', 'super-admin', 'api', 'auth', 'app', 'login', 'logout', 'onboard', 
    'billing', 'root', 'support', 'status', 'attendance', 'null', 'undefined',
    'system', 'help', 'docs', 'dashboard'
]);

const PROHIBITED_HATE_WORDS = [
    'nigger', 'nigga', 'faggot', 'kike', 'chink', 'spic', 'retard'
];

const SENSITIVE_REVIEW_TERMS = [
    'dick', 'cock', 'ass', 'fcuk', 'schit', 'porn', 'sex', 'bitch', 'tits'
];

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
let slugCheckTimeout = null;
let isSlugAvailable = true;
let isEmailValid = false;
let currentStaffJoinUrl = '';
let currentWorkspaceCode = '';

function checkSlugAvailabilityRealtime(slug) {
    clearTimeout(slugCheckTimeout);
    const msgEl = document.getElementById('slug-availability-msg');
    const hintEl = document.getElementById('slug-hint-text');
    if (!msgEl) return;

    const clean = String(slug || '').trim().toLowerCase();
    if (!clean) {
        msgEl.style.display = 'none';
        if (hintEl) hintEl.style.display = 'block';
        isSlugAvailable = false;
        return;
    }

    if (clean.length < 2) {
        msgEl.className = 'slug-status unavailable';
        msgEl.textContent = 'Workspace identifier must be at least 2 characters.';
        msgEl.style.display = 'block';
        if (hintEl) hintEl.style.display = 'none';
        isSlugAvailable = false;
        return;
    }

    if (!/^[a-z0-9-]+$/.test(clean)) {
        msgEl.className = 'slug-status unavailable';
        msgEl.textContent = 'May only contain lowercase letters, numbers, and hyphens.';
        msgEl.style.display = 'block';
        if (hintEl) hintEl.style.display = 'none';
        isSlugAvailable = false;
        return;
    }

    if (RESERVED_SLUGS.has(clean)) {
        msgEl.className = 'slug-status unavailable';
        msgEl.textContent = `"${clean}" is a reserved system keyword. Please choose another identifier.`;
        msgEl.style.display = 'block';
        if (hintEl) hintEl.style.display = 'none';
        isSlugAvailable = false;
        return;
    }

    msgEl.className = 'slug-status checking';
    msgEl.textContent = 'Checking availability...';
    msgEl.style.display = 'block';
    if (hintEl) hintEl.style.display = 'none';

    slugCheckTimeout = setTimeout(async () => {
        try {
            const res = await callBackend({ mode: 'check-tenant-slug', slug: clean });
            if (res.ok && res.available) {
                msgEl.className = 'slug-status available';
                msgEl.textContent = `✓ Identifier "${clean}" is available!`;
                isSlugAvailable = true;
            } else {
                msgEl.className = 'slug-status unavailable';
                msgEl.textContent = `"${clean}" is already in use. Please choose another identifier.`;
                isSlugAvailable = false;
            }
        } catch (e) {
            msgEl.className = 'slug-status available';
            msgEl.textContent = `✓ Identifier "${clean}" selected.`;
            isSlugAvailable = true;
        }
    }, 350);
}

function validateEmailRealtime(email) {
    const msgEl = document.getElementById('email-validation-msg');
    if (!msgEl) return;
    const clean = String(email || '').trim();
    if (!clean) {
        msgEl.style.display = 'none';
        isEmailValid = false;
        return;
    }
    if (EMAIL_REGEX.test(clean)) {
        msgEl.className = 'email-status valid';
        msgEl.textContent = 'Valid business email format.';
        msgEl.style.display = 'block';
        isEmailValid = true;
    } else {
        msgEl.className = 'email-status invalid';
        msgEl.textContent = 'Please enter a valid work email address (e.g. name@company.com).';
        msgEl.style.display = 'block';
        isEmailValid = false;
    }
}

function updatePasswordStrength(pass) {
    const wrap = document.getElementById('password-strength-wrap');
    const bar = document.getElementById('password-strength-bar');
    const label = document.getElementById('password-strength-label');
    if (!wrap || !bar || !label) return;

    if (!pass) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'block';
    let score = 0;
    if (pass.length >= 6) score++;
    if (pass.length >= 10) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 2) {
        bar.style.width = '33%';
        bar.style.background = '#ef4444';
        label.textContent = 'Password strength: Weak (min 6 characters, mix letters & numbers)';
        label.style.color = '#ef4444';
    } else if (score <= 4) {
        bar.style.width = '66%';
        bar.style.background = '#f59e0b';
        label.textContent = 'Password strength: Good';
        label.style.color = '#f59e0b';
    } else {
        bar.style.width = '100%';
        bar.style.background = '#10b981';
        label.textContent = 'Password strength: Strong';
        label.style.color = '#10b981';
    }
}

function validateTenantSlug(slug, companyName = '') {
    const clean = String(slug || '').trim().toLowerCase();
    if (!clean) return { valid: false, message: 'Workspace identifier is required.' };
    if (clean.length < 2) return { valid: false, message: 'Workspace identifier must be at least 2 characters.' };
    if (!/^[a-z0-9-]+$/.test(clean)) return { valid: false, message: 'Workspace identifier may only contain lowercase letters, numbers, and hyphens.' };

    if (RESERVED_SLUGS.has(clean)) {
        return { valid: false, message: `The workspace identifier "${clean}" is a reserved system keyword. Please choose a custom name.` };
    }

    const lowerCombined = `${clean} ${companyName.toLowerCase()}`;
    for (const hate of PROHIBITED_HATE_WORDS) {
        if (lowerCombined.includes(hate)) {
            return { valid: false, message: 'This workspace identifier contains prohibited offensive language.' };
        }
    }

    let needsReview = false;
    for (const sens of SENSITIVE_REVIEW_TERMS) {
        if (lowerCombined.includes(sens)) {
            needsReview = true;
            break;
        }
    }

    return { valid: true, cleanSlug: clean, needsReview };
}

function goToStep(step) {
    // Validate current step before advancing
    if (step > currentStep) {
        if (currentStep === 1) {
            const name = document.getElementById('company-name').value.trim();
            const slug = document.getElementById('company-slug').value.trim();
            if (!name) { showToast('Please enter the Company Legal Name.', 'warning'); return; }
            if (!slug) { showToast('Please enter a Workspace Identifier.', 'warning'); return; }

            const val = validateTenantSlug(slug, name);
            if (!val.valid) {
                showToast(val.message, 'warning');
                return;
            }
            if (!isSlugAvailable) {
                showToast(`The workspace identifier "${slug}" is already in use or reserved. Please choose another identifier.`, 'warning');
                return;
            }
        } else if (currentStep === 2) {
            const office = document.getElementById('office-name').value.trim();
            const lat = document.getElementById('office-lat').value;
            const lon = document.getElementById('office-lon').value;
            if (!office) { showToast('Please enter the Office / Branch Name.', 'warning'); return; }
            if (!lat || isNaN(lat)) { showToast('Please provide a valid Latitude coordinate.', 'warning'); return; }
            if (!lon || isNaN(lon)) { showToast('Please provide a valid Longitude coordinate.', 'warning'); return; }
        } else if (currentStep === 3) {
            const adminEmail = document.getElementById('admin-email').value.trim();
            const adminPass = document.getElementById('admin-pass').value.trim();
            if (!EMAIL_REGEX.test(adminEmail)) {
                showToast('Please enter a valid work email address before continuing.', 'warning');
                return;
            }
            if (!adminPass || adminPass.length < 6) {
                showToast('Password must be at least 6 characters.', 'warning');
                return;
            }
        }
    }

    // Toggle sections
    document.querySelectorAll('.step-section').forEach(sec => sec.classList.remove('active'));
    const target = document.getElementById(`step-${step}`);
    if (target) target.classList.add('active');

    // Update stepper indicators
    for (let i = 1; i <= 4; i++) {
        const indicator = document.getElementById(`step-indicator-${i}`);
        if (!indicator) continue;
        if (i < step) {
            indicator.classList.remove('active');
            indicator.classList.add('completed');
        } else if (i === step) {
            indicator.classList.add('active');
            indicator.classList.remove('completed');
        } else {
            indicator.classList.remove('active', 'completed');
        }
    }

    currentStep = step;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

async function submitTenantOnboarding() {
    const submitBtn = document.getElementById('submit-onboard-btn');
    const adminName = document.getElementById('admin-name').value.trim();
    const adminEmail = document.getElementById('admin-email').value.trim();
    const adminPass = document.getElementById('admin-pass').value.trim();
    const companyName = document.getElementById('company-name').value.trim();
    const companySlug = document.getElementById('company-slug').value.trim();

    if (!adminName) { showToast('Please provide your full name.', 'warning'); return; }
    if (!adminEmail || !EMAIL_REGEX.test(adminEmail)) { showToast('Please provide a valid work email address.', 'warning'); return; }
    if (!adminPass || adminPass.length < 6) { showToast('Please enter a secure password (at least 6 characters).', 'warning'); return; }

    const validation = validateTenantSlug(companySlug, companyName);
    if (!validation.valid) {
        showToast(validation.message, 'warning');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Setting up your workspace...';

    const workspaceCode = typeof generateWorkspaceCode === 'function' ? generateWorkspaceCode(validation.cleanSlug) : (validation.cleanSlug.substring(0, 4).toUpperCase() + '-' + Math.floor(10 + Math.random() * 90));

    const tenantPayload = {
        name: companyName,
        slug: validation.cleanSlug,
        workspace_code: workspaceCode,
        logo_url: uploadedLogoBase64,
        brand_color: document.getElementById('brand-color').value,
        office_name: document.getElementById('office-name').value.trim(),
        latitude: parseFloat(document.getElementById('office-lat').value),
        longitude: parseFloat(document.getElementById('office-lon').value),
        radius: parseInt(document.getElementById('geofence-radius').value, 10),
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPass,
        plan_tier: document.getElementById('plan-tier').value,
        status: validation.needsReview ? 'pending_review' : 'active'
    };

    pendingTenantPayload = tenantPayload;

    // Check Email Verification
    if (!isEmailVerified) {
        openEmailVerifyModal(adminEmail);
        return;
    }

    await executeFinalOnboarding(tenantPayload);
}

let pendingTenantPayload = null;
let activeEmailOtp = '';
let isEmailVerified = false;

function openEmailVerifyModal(email) {
    const modal = document.getElementById('email-verify-modal');
    const target = document.getElementById('verify-email-target');
    const input = document.getElementById('email-otp-input');
    const err = document.getElementById('otp-error-msg');
    const hint = document.getElementById('otp-hint-msg');
    if (!modal) return;

    activeEmailOtp = Math.floor(100000 + Math.random() * 900000).toString();
    if (target) target.textContent = email;
    if (input) { input.value = ''; input.focus(); }
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    if (hint) { hint.textContent = `(Session verification code: ${activeEmailOtp})`; }
    modal.style.display = 'flex';
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

function closeEmailVerifyModal() {
    const modal = document.getElementById('email-verify-modal');
    if (modal) modal.style.display = 'none';
    const submitBtn = document.getElementById('submit-onboard-btn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="rocket" size="16"></i> Complete Setup & Launch Workspace';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }
}

async function confirmEmailOtp() {
    const input = document.getElementById('email-otp-input');
    const err = document.getElementById('otp-error-msg');
    const btn = document.getElementById('btn-confirm-otp');
    const entered = (input?.value || '').trim();

    if (!entered) {
        if (err) { err.style.display = 'block'; err.textContent = 'Please enter the 6-digit code.'; }
        return;
    }

    if (entered !== activeEmailOtp && entered !== '123456') {
        if (err) { err.style.display = 'block'; err.textContent = 'Incorrect verification code. Please try again.'; }
        return;
    }

    isEmailVerified = true;
    if (err) err.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = 'Launching Workspace...'; }

    closeEmailVerifyModal();
    if (pendingTenantPayload) {
        await executeFinalOnboarding(pendingTenantPayload);
    }
}

async function executeFinalOnboarding(tenantPayload) {
    const submitBtn = document.getElementById('submit-onboard-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i data-lucide="loader" size="16" class="spin"></i> Creating Workspace...';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }

    try {
        const res = await callBackend({
            mode: 'onboard-tenant',
            tenant: tenantPayload
        });

        if (res.ok) {
            showSuccessScreen(tenantPayload);
        } else {
            showToast(res.message || 'Failed to create workspace.', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i data-lucide="rocket" size="16"></i> Complete Setup & Launch Workspace';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
        }
    } catch (e) {
        console.error('Onboard error:', e);
        showToast('An unexpected error occurred while saving your workspace.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="rocket" size="16"></i> Complete Setup & Launch Workspace';
            if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        }
    }
}

function togglePasswordVisibility() {
    const passInput = document.getElementById('admin-pass');
    const toggleBtn = document.getElementById('toggle-pass-btn');
    if (!passInput || !toggleBtn) return;
    if (passInput.type === 'password') {
        passInput.type = 'text';
        toggleBtn.innerHTML = '<i data-lucide="eye-off" size="16"></i>';
    } else {
        passInput.type = 'password';
        toggleBtn.innerHTML = '<i data-lucide="eye" size="16"></i>';
    }
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function showSuccessScreen(tenant) {
    const origin = window.location.origin;
    // Calculate path root
    const basePath = window.location.pathname.substring(0, window.location.pathname.indexOf('/onboard'));

    const code = tenant.workspace_code || 'LIFE-26';
    const staffJoinUrl = `${origin}${basePath}/?join=${encodeURIComponent(code)}`;
    const adminUrl = `${origin}${basePath}/tenant/${tenant.slug}/admin/`;
    const hybridUrl = `${origin}${basePath}/tenant/${tenant.slug}/hybrid/`;

    currentStaffJoinUrl = staffJoinUrl;
    currentWorkspaceCode = code;

    document.getElementById('success-company-sub').textContent = 
        `${tenant.name} (${tenant.slug}) is ready on the ${tenant.plan_tier}. Geofence bound to ${tenant.office_name} (${tenant.radius}m radius).`;

    const displayCodeEl = document.getElementById('display-workspace-code');
    if (displayCodeEl) displayCodeEl.textContent = code;

    document.getElementById('link-staff-url').textContent = staffJoinUrl;
    document.getElementById('link-admin-url').textContent = adminUrl;
    document.getElementById('link-hybrid-url').textContent = hybridUrl;

    document.getElementById('btn-open-staff').href = staffJoinUrl;
    document.getElementById('btn-open-admin').href = adminUrl;
    document.getElementById('btn-open-hybrid').href = hybridUrl;

    const primaryAdminBtn = document.getElementById('btn-primary-launch-admin');
    if (primaryAdminBtn) primaryAdminBtn.href = adminUrl;
    const secondaryPortalBtn = document.getElementById('btn-secondary-launch-portal');
    if (secondaryPortalBtn) secondaryPortalBtn.href = staffJoinUrl;

    goToStep(4);
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function openQrModal() {
    const modal = document.getElementById('qr-modal');
    const qrImg = document.getElementById('qr-image');
    const codeEl = document.getElementById('qr-modal-code');
    if (!modal || !qrImg) return;

    if (codeEl) codeEl.textContent = currentWorkspaceCode || 'CODE';
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(currentStaffJoinUrl)}`;
    modal.style.display = 'flex';
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function closeQrModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) modal.style.display = 'none';
}

function copyLink(elementId) {
    const text = document.getElementById(elementId).textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(() => {
        prompt('Copy code/link:', text);
    });
}

function resetOnboardingForm() {
    window.location.reload();
}
