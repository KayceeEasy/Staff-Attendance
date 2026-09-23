
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

const MASTER_PLATFORM_KEY = 'ChckpointMaster2026!';
const LEGACY_MASTER_PLATFORM_KEY = 'LifecardMaster2026!';
const SESSION_KEY = 'attendance_super_admin_unlocked';

let tenantsCache = [];

document.addEventListener('DOMContentLoaded', () => {
    if (typeof initTheme === 'function') initTheme();
    initSuperAdminModalDismissals();
    checkMasterAuth();
});

async function getMasterKeyHash() {
    try {
        if (!supabaseClient) return null;
        const { data, error } = await supabaseClient.from('app_config').select('value').eq('key', 'SUPER_ADMIN_MASTER_KEY_HASH').single();
        if (!error && data && data.value) {
            return String(data.value).trim();
        }
    } catch(e) {}
    return null;
}

async function verifyMasterKey(inputKey) {
    if (!inputKey) return false;
    const clean = inputKey.trim();
    const storedHash = await getMasterKeyHash();
    if (storedHash) {
        try {
            const inputHash = await sha256Hex(clean);
            return inputHash === storedHash;
        } catch(e) {
            return false;
        }
    }
    return clean === MASTER_PLATFORM_KEY || clean === LEGACY_MASTER_PLATFORM_KEY;
}

function checkMasterAuth() {
    const isUnlocked = sessionStorage.getItem(SESSION_KEY) === 'true';
    const gateModal = document.getElementById('auth-gate-modal');
    const shell = document.getElementById('super-admin-shell');

    if (isUnlocked) {
        if (gateModal) gateModal.style.display = 'none';
        if (shell) shell.style.display = 'flex';
        initSuperAdminDashboard();
    } else {
        if (gateModal) gateModal.style.display = 'flex';
        if (shell) shell.style.display = 'none';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }
}

async function handleMasterLogin(e) {
    e.preventDefault();
    const input = document.getElementById('master-key-input');
    const errorEl = document.getElementById('auth-error-msg');
    const submitBtn = document.getElementById('auth-submit-btn');
    const val = (input.value || '').trim();

    if (!val) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verifying...'; }

    const isValid = await verifyMasterKey(val);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Unlock Command Console'; }

    if (isValid) {
        sessionStorage.setItem(SESSION_KEY, 'true');
        sessionStorage.setItem('active_master_key_secret', val);
        checkMasterAuth();
    } else {
        errorEl.textContent = 'Invalid Master Platform Key. Access Denied.';
        errorEl.style.display = 'block';
        input.value = '';
        input.focus();
    }
}

function handleLockConsole() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.reload();
}

async function initSuperAdminDashboard() {
    lucide.createIcons();
    await checkSystemHealth();
    await loadFleetData();
    await loadGlobalActivityFeed();
}

async function checkSystemHealth() {
    const chipText = document.getElementById('health-text');
    const latencyEl = document.getElementById('metric-latency');
    const start = performance.now();

    try {
        if (!supabaseClient) {
            chipText.textContent = 'Supabase DB: Offline';
            return;
        }
        const { data, error } = await supabaseClient.from('app_config').select('key').limit(1);
        const duration = Math.round(performance.now() - start);

        if (!error) {
            chipText.textContent = `Supabase DB: Live (${duration}ms)`;
            latencyEl.textContent = `${duration} ms`;
        } else {
            chipText.textContent = `DB Error: ${error.message}`;
            latencyEl.textContent = 'Error';
        }
    } catch (e) {
        chipText.textContent = 'Connection Error';
        latencyEl.textContent = '--';
    }
}

async function loadFleetData() {
    try {
        tenantsCache = await getTenantRegistry();
        renderTenantsTable(tenantsCache);

        document.getElementById('metric-tenants-count').textContent = tenantsCache.length;

        // Fetch cross-tenant staff count
        if (supabaseClient) {
            const { count: staffCount } = await supabaseClient.from('staff').select('*', { count: 'exact', head: true });
            document.getElementById('metric-staff-count').textContent = staffCount || '--';

            // Today's attendance
            const todayIso = new Date().toISOString().split('T')[0];
            const { count: checkinCount } = await supabaseClient
                .from('attendance')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', todayIso + 'T00:00:00Z');
            document.getElementById('metric-checkins-today').textContent = checkinCount || '0';
        }
    } catch (e) {
        console.error('Error loading fleet data:', e);
    }
}

let activeMasterTenantSlug = null;
let activeMasterStaffCache = [];

function renderTenantsTable(tenants) {
    const tbody = document.getElementById('tenant-tbody');
    if (!tenants || !tenants.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-td">No client tenants found.</td></tr>';
        return;
    }

    const basePath = window.location.pathname.substring(0, window.location.pathname.indexOf('/super-admin'));
    const origin = window.location.origin;

    tbody.innerHTML = tenants.map(t => {
        const logoHtml = t.logo_url
            ? `<img src="${t.logo_url}" class="company-logo-thumb" alt="${escapeHtml(t.name)}" />`
            : `<div class="company-logo-placeholder">${escapeHtml((t.name || 'C').substring(0, 1).toUpperCase())}</div>`;

        const code = t.workspace_code || (t.slug ? t.slug.substring(0, 4).toUpperCase() + '-26' : 'WKS-01');
        const staffLink = `${origin}${basePath}/?join=${encodeURIComponent(code)}`;

        const statusClass = t.status === 'suspended' ? 'suspended' : t.status === 'pending_review' ? 'pending_review' : 'active';
        const statusLabel = t.status === 'suspended' ? 'Suspended' : t.status === 'pending_review' ? 'Pending Review' : 'Active';

        return `
            <tr>
                <td>
                    <div class="company-cell">
                        ${logoHtml}
                        <div>
                            <div class="company-name" style="cursor:pointer;" onclick="openTenantMasterModal('${escapeHtml(t.slug)}')">
                                ${escapeHtml(t.name)}
                            </div>
                            <div class="company-slug" style="display:flex; align-items:center; gap:6px;">
                                <span style="background:rgba(26,86,219,0.1); color:var(--primary); padding:1px 5px; border-radius:4px; font-weight:700; font-size:0.72rem; letter-spacing:1px;">${escapeHtml(code)}</span>
                                <span style="font-size:0.75rem; color:var(--text-muted);">/tenant/${escapeHtml(t.slug)}/</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <span class="tier-badge ${t.plan_tier || 'Pro'}">${escapeHtml(t.plan_tier || 'Pro')}</span>
                </td>
                <td>
                    <div style="font-weight:600;">${escapeHtml(t.office_name || 'Main Office')}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${Number(t.latitude).toFixed(4)}, ${Number(t.longitude).toFixed(4)} (${t.radius || 100}m)</div>
                </td>
                <td>
                    <span class="status-pill ${statusClass}" onclick="toggleTenantStatus('${escapeHtml(t.slug)}')">
                        ${statusLabel}
                    </span>
                </td>
                <td>
                    <div class="action-links">
                        <button type="button" class="action-btn primary" onclick="openTenantMasterModal('${escapeHtml(t.slug)}')" title="Full Master Control">
                            <i data-lucide="sliders" size="13"></i> Master Control
                        </button>
                        <button type="button" class="action-btn" onclick="handleMasqueradeAdmin('${escapeHtml(t.slug)}')" title="Launch Admin Console as Operator">
                            <i data-lucide="zap" size="13"></i> Launch Admin
                        </button>
                        <a href="${staffLink}" target="_blank" class="action-btn" title="Open Staff Check-In Clean Link">
                            <i data-lucide="link-2" size="13"></i> Clean Link
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function filterTenantTable() {
    const q = document.getElementById('tenant-search-input').value.toLowerCase().trim();
    const filtered = tenantsCache.filter(t => 
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.slug && t.slug.toLowerCase().includes(q)) ||
        (t.office_name && t.office_name.toLowerCase().includes(q))
    );
    renderTenantsTable(filtered);
}

async function toggleTenantStatus(slug) {
    const tenant = tenantsCache.find(t => t.slug === slug);
    if (!tenant) return;

    const nextStatus = tenant.status === 'suspended' ? 'active' : 'suspended';
    const confirmMsg = `Change account status of ${tenant.name} to ${nextStatus.toUpperCase()}?`;
    if (!confirm(confirmMsg)) return;

    const res = await callBackend({
        mode: 'update-tenant',
        slug: slug,
        updates: { status: nextStatus }
    });

    if (res.ok) {
        await loadFleetData();
    } else {
        showToast(res.message || 'Failed to update status.', 'error');
    }
}

/* ---------- Tenant Master Control Modal Operations ---------- */

async function openTenantMasterModal(slug) {
    const tenant = tenantsCache.find(t => t.slug === slug);
    if (!tenant) return;

    activeMasterTenantSlug = slug;

    // Set header
    document.getElementById('modal-company-name').textContent = tenant.name;
    document.getElementById('modal-company-slug-badge').textContent = `/tenant/${tenant.slug}/`;
    const logoWrap = document.getElementById('modal-company-logo-wrap');
    if (tenant.logo_url) {
        logoWrap.innerHTML = `<img src="${tenant.logo_url}" alt="logo" style="max-height:36px; max-width:80px; object-fit:contain;" />`;
    } else {
        logoWrap.innerHTML = `<div class="company-logo-placeholder">${escapeHtml(tenant.name.substring(0, 1).toUpperCase())}</div>`;
    }

    // Populate Tab 1: Profile
    document.getElementById('master-company-name').value = tenant.name || '';
    document.getElementById('master-company-slug').value = tenant.slug || '';
    document.getElementById('master-plan-tier').value = tenant.plan_tier || 'Pro';
    document.getElementById('master-status').value = tenant.status || 'active';
    document.getElementById('master-admin-name').value = tenant.admin_name || '';
    document.getElementById('master-admin-email').value = tenant.admin_email || '';
    document.getElementById('master-brand-color').value = tenant.brand_color || '#1a56db';
    document.getElementById('master-brand-color-text').value = tenant.brand_color || '#1a56db';
    const logoInput = document.getElementById('master-logo-url');
    const logoPreviewWrap = document.getElementById('master-logo-preview-wrap');
    const logoPreview = document.getElementById('master-logo-preview');
    const logoFileInput = document.getElementById('master-logo-file');
    const logoRemoveBtn = document.getElementById('master-logo-remove-btn');

    logoInput.value = tenant.logo_url || '';
    if (tenant.logo_url && logoPreview && logoPreviewWrap) {
        logoPreview.src = tenant.logo_url;
        logoPreviewWrap.style.display = 'flex';
    } else if (logoPreviewWrap) {
        logoPreview.src = '';
        logoPreviewWrap.style.display = 'none';
    }

    logoInput.oninput = () => {
        const val = logoInput.value.trim();
        if (val && logoPreview && logoPreviewWrap) {
            logoPreview.src = val;
            logoPreviewWrap.style.display = 'flex';
        } else if (logoPreviewWrap) {
            logoPreview.src = '';
            logoPreviewWrap.style.display = 'none';
        }
    };

    if (logoFileInput && !logoFileInput.dataset.bound) {
        logoFileInput.dataset.bound = 'true';
        logoFileInput.onchange = () => {
            const file = logoFileInput.files && logoFileInput.files[0];
            if (file) {
                if (!file.type.startsWith('image/')) {
                    showToast('Please select an image file (PNG, JPG, or SVG).', 'warning');
                    return;
                }
                const reader = new FileReader();
                reader.onload = (e) => {
                    logoInput.value = e.target.result;
                    if (logoPreview && logoPreviewWrap) {
                        logoPreview.src = e.target.result;
                        logoPreviewWrap.style.display = 'flex';
                    }
                };
                reader.readAsDataURL(file);
            }
        };
    }

    if (logoRemoveBtn && !logoRemoveBtn.dataset.bound) {
        logoRemoveBtn.dataset.bound = 'true';
        logoRemoveBtn.onclick = () => {
            logoInput.value = '';
            if (logoPreview && logoPreviewWrap) {
                logoPreview.src = '';
                logoPreviewWrap.style.display = 'none';
            }
            if (logoFileInput) logoFileInput.value = '';
        };
    }

    // Color input listener sync
    document.getElementById('master-brand-color').oninput = (e) => {
        document.getElementById('master-brand-color-text').value = e.target.value;
    };
    document.getElementById('master-brand-color-text').oninput = (e) => {
        document.getElementById('master-brand-color').value = e.target.value;
    };

    // Populate Tab 2: GPS & Policies
    const config = await getTenantConfig(slug);
    document.getElementById('master-office-name').value = tenant.office_name || config.office_name || '';
    document.getElementById('master-latitude').value = tenant.latitude || config.latitude || 6.4357;
    document.getElementById('master-longitude').value = tenant.longitude || config.longitude || 3.4738;
    document.getElementById('master-radius').value = tenant.radius || config.radius || 100;
    document.getElementById('master-grace-period').value = config.grace_period_minutes || 15;
    document.getElementById('master-default-policy').value = config.default_policy || 'weekly_hybrid';

    // Show modal & default tab
    switchMasterTab('tab-profile');
    document.getElementById('tenant-master-modal').style.display = 'flex';

    // Load staff roster in background
    loadTenantMasterStaff(slug);
}

function closeTenantMasterModal() {
    document.getElementById('tenant-master-modal').style.display = 'none';
    activeMasterTenantSlug = null;
}

function scrollMasterTabs(delta) {
    const strip = document.getElementById('modal-tabs-strip');
    if (strip) {
        strip.scrollBy({ left: delta, behavior: 'smooth' });
    }
}

function switchMasterTab(tabId) {
    document.querySelectorAll('.modal-tab').forEach(b => {
        const isActive = b.dataset.tab === tabId;
        b.classList.toggle('active', isActive);
        if (isActive && b.scrollIntoView) {
            b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === tabId);
    });
    if (tabId === 'tab-staff' && activeMasterTenantSlug) {
        loadTenantMasterStaff(activeMasterTenantSlug);
    }
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

async function handleSaveMasterProfile(e) {
    e.preventDefault();
    if (!activeMasterTenantSlug) return;
    const btn = document.getElementById('btn-save-master-profile');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const updates = {
        name: document.getElementById('master-company-name').value.trim(),
        slug: document.getElementById('master-company-slug').value.trim().toLowerCase(),
        plan_tier: document.getElementById('master-plan-tier').value,
        status: document.getElementById('master-status').value,
        admin_name: document.getElementById('master-admin-name').value.trim(),
        admin_email: document.getElementById('master-admin-email').value.trim(),
        brand_color: document.getElementById('master-brand-color').value,
        logo_url: document.getElementById('master-logo-url').value.trim()
    };

    const res = await callBackend({
        mode: 'super-admin-update-tenant-full',
        slug: activeMasterTenantSlug,
        updates
    });

    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save" size="14"></i> Save Profile Changes';
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();

    if (res.ok) {
        activeMasterTenantSlug = updates.slug;
        showToast('Company profile updated successfully!', 'success');
        await loadFleetData();
        openTenantMasterModal(activeMasterTenantSlug);
    } else {
        showToast(res.message || 'Failed to update profile.', 'error');
    }
}

async function handleSaveMasterPolicies(e) {
    e.preventDefault();
    if (!activeMasterTenantSlug) return;
    const btn = document.getElementById('btn-save-master-policies');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const office_name = document.getElementById('master-office-name').value.trim();
    const latitude = parseFloat(document.getElementById('master-latitude').value);
    const longitude = parseFloat(document.getElementById('master-longitude').value);
    const radius = parseInt(document.getElementById('master-radius').value, 10);
    const grace_period_minutes = parseInt(document.getElementById('master-grace-period').value, 10);
    const default_policy = document.getElementById('master-default-policy').value;

    const res = await callBackend({
        mode: 'super-admin-update-tenant-full',
        slug: activeMasterTenantSlug,
        updates: { office_name, latitude, longitude, radius },
        config: { office_name, latitude, longitude, radius, grace_period_minutes, default_policy }
    });

    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save" size="14"></i> Save Policies & Geofence';
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();

    if (res.ok) {
        showToast('Office policies and geofence saved successfully!', 'success');
        await loadFleetData();
    } else {
        showToast(res.message || 'Failed to save policies.', 'error');
    }
}

/* ---------- Staff Management in Master Control ---------- */

async function loadTenantMasterStaff(slug) {
    const tbody = document.getElementById('master-staff-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="loading-td">Loading staff roster...</td></tr>';

    const res = await callBackend({ mode: 'list-staff', tenantSlug: slug });
    if (!res.ok || !Array.isArray(res.staff) || !res.staff.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--text-muted);">No employees registered for this company yet.</td></tr>';
        activeMasterStaffCache = [];
        return;
    }

    activeMasterStaffCache = res.staff;
    tbody.innerHTML = res.staff.map(s => {
        const isLinked = Boolean(s.device_id || s.deviceId);
        return `
            <tr>
                <td>
                    <strong>${escapeHtml(s.name)}</strong>
                    ${s.is_team_lead ? '<span style="font-size:0.7rem; background:rgba(245,158,11,0.15); color:#d97706; padding:2px 5px; border-radius:4px; font-weight:700; margin-left:4px;">Lead</span>' : ''}
                </td>
                <td>${escapeHtml(s.dept || 'General')}</td>
                <td><span style="font-size:0.75rem;">${escapeHtml(s.schedule_policy || 'weekly_hybrid')}</span></td>
                <td>
                    <span class="status-pill-small ${isLinked ? 'synced' : 'pending'}" style="font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;">
                        <i data-lucide="${isLinked ? 'smartphone' : 'smartphone-nfc'}" size="12"></i> ${isLinked ? 'Linked' : 'Unlinked'}
                    </span>
                </td>
                <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px; align-items:center;">
                        <button type="button" class="action-btn" onclick="handleUnlinkStaffDevice('${escapeHtml(s.name)}')" title="Reset Device Link">
                            <i data-lucide="refresh-cw" size="12"></i> Reset Link
                        </button>
                        <button type="button" class="action-btn" onclick="handleRemoveStaffMember('${escapeHtml(s.name)}')" style="color:var(--danger);" title="Remove Employee">
                            <i data-lucide="trash-2" size="12"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function toggleAddStaffForm() {
    const box = document.getElementById('inline-add-staff-box');
    if (!box) return;
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function handleCreateTenantStaff() {
    if (!activeMasterTenantSlug) return;
    const name = document.getElementById('new-staff-name').value.trim();
    const dept = document.getElementById('new-staff-dept').value.trim();
    const policy = document.getElementById('new-staff-policy').value;
    const isLead = document.getElementById('new-staff-is-lead').checked;

    if (!name) { showToast('Please enter employee name.', 'warning'); return; }

    const res = await callBackend({
        mode: 'add-staff',
        tenantSlug: activeMasterTenantSlug,
        name,
        dept: dept || 'General',
        schedule_policy: policy,
        is_team_lead: isLead
    });

    if (res.ok) {
        document.getElementById('new-staff-name').value = '';
        document.getElementById('new-staff-dept').value = '';
        toggleAddStaffForm();
        loadTenantMasterStaff(activeMasterTenantSlug);
    } else {
        showToast(res.message || 'Failed to add staff member.', 'error');
    }
}

async function handleUnlinkStaffDevice(staffName) {
    if (!confirm(`Reset device pairing for ${staffName}?\nThis unlinks their registered phone so they can link a new device.`)) return;
    const res = await callBackend({
        mode: 'unlink-staff-device',
        tenantSlug: activeMasterTenantSlug,
        name: staffName
    });
    if (res.ok) {
        loadTenantMasterStaff(activeMasterTenantSlug);
    } else {
        showToast(res.message || 'Failed to unlink device.', 'error');
    }
}

async function handleRemoveStaffMember(staffName) {
    if (!confirm(`Permanently remove ${staffName} from this company?`)) return;
    const res = await callBackend({
        mode: 'remove-staff',
        tenantSlug: activeMasterTenantSlug,
        name: staffName
    });
    if (res.ok) {
        loadTenantMasterStaff(activeMasterTenantSlug);
    } else {
        showToast(res.message || 'Failed to remove staff member.', 'error');
    }
}

/* ---------- Security, Masquerade & Danger Zone Operations ---------- */

async function handleResetAdminPassword() {
    if (!activeMasterTenantSlug) return;
    const newPass = document.getElementById('master-new-admin-pass').value.trim();
    if (!newPass) { showToast('Please enter a new password.', 'warning'); return; }

    const res = await callBackend({
        mode: 'super-admin-reset-tenant-password',
        slug: activeMasterTenantSlug,
        newPassword: newPass
    });

    if (res.ok) {
        showToast(res.message || 'Operation successful', 'success');
        document.getElementById('master-new-admin-pass').value = '';
    } else {
        showToast(res.message || 'Failed to reset password.', 'error');
    }
}

async function handleSuperAdminExtendTrial(days = 14) {
    if (!activeMasterTenantSlug) return;
    const res = await callBackend({
        mode: 'extend-tenant-trial',
        tenantSlug: activeMasterTenantSlug,
        days: days
    });
    if (res.ok) {
        showToast(res.message || 'Operation successful', 'success');
        loadFleetTenants();
    } else {
        showToast(res.message || 'Failed to extend trial.', 'error');
    }
}

async function handleSuperAdminToggleRetention() {
    if (!activeMasterTenantSlug) return;
    const res = await callBackend({
        mode: 'apply-retention-deal',
        slug: activeMasterTenantSlug,
        discount_percent: 50,
        duration_months: 3
    });
    if (res.ok) {
        showToast('50% Retention Deal applied to this workspace.', 'success');
        loadFleetTenants();
    } else {
        showToast(res.message || 'Failed to apply retention deal.', 'error');
    }
}

async function generateMasqueradeToken(slug) {
    const ts = Date.now();
    const activeSecret = sessionStorage.getItem('active_master_key_secret') || MASTER_PLATFORM_KEY;
    const masterKeyHash = await sha256Hex(activeSecret);
    const hash = await sha256Hex(`${slug}:${ts}:${masterKeyHash}`);
    const tokenPayload = { slug, ts, hash, op: 'SuperAdmin' };
    return btoa(JSON.stringify(tokenPayload));
}

async function handleMasqueradeAdmin(slug) {
    const targetSlug = slug || activeMasterTenantSlug;
    if (!targetSlug) return;
    const token = await generateMasqueradeToken(targetSlug);
    const basePath = window.location.pathname.substring(0, window.location.pathname.indexOf('/super-admin'));
    const origin = window.location.origin;
    const url = `${origin}${basePath}/tenant/${encodeURIComponent(targetSlug)}/admin/?masquerade=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
}

function handleMasqueradePortal() {
    if (!activeMasterTenantSlug) return;
    const basePath = window.location.pathname.substring(0, window.location.pathname.indexOf('/super-admin'));
    window.open(`${window.location.origin}${basePath}/tenant/${activeMasterTenantSlug}/`, '_blank');
}

function handleMasqueradeHybrid() {
    if (!activeMasterTenantSlug) return;
    const basePath = window.location.pathname.substring(0, window.location.pathname.indexOf('/super-admin'));
    window.open(`${window.location.origin}${basePath}/tenant/${activeMasterTenantSlug}/hybrid/?key=admin`, '_blank');
}

async function handleExportTenantData() {
    if (!activeMasterTenantSlug) return;
    const tenant = tenantsCache.find(t => t.slug === activeMasterTenantSlug);
    const config = await getTenantConfig(activeMasterTenantSlug);
    const staff = await getTenantStaffList(activeMasterTenantSlug);

    const exportObj = {
        version: '3.0.0',
        exported_at: new Date().toISOString(),
        tenant,
        config,
        staff
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `${activeMasterTenantSlug}-archive.json`;
    a.click();
}

async function handleImportTenantData(e) {
    if (!activeMasterTenantSlug) return;
    const fileInput = document.getElementById('master-import-file');
    const statusEl = document.getElementById('master-import-status');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        showToast('Please select a valid .json archive file to restore.', 'warning');
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async (event) => {
        try {
            if (statusEl) {
                statusEl.textContent = 'Parsing and restoring workspace archive...';
                statusEl.style.color = 'var(--text-muted)';
            }
            const parsed = JSON.parse(event.target.result);

            if (!parsed || (!parsed.tenant && !parsed.staff && !parsed.config)) {
                throw new Error('Invalid workspace archive format: missing tenant, staff, or config.');
            }

            const targetSlug = activeMasterTenantSlug;

            // 1. Restore config if present
            if (parsed.config) {
                await saveTenantConfig(targetSlug, parsed.config);
            }

            // 2. Restore staff roster if present
            if (Array.isArray(parsed.staff)) {
                await saveTenantStaffList(targetSlug, parsed.staff);
            }

            // 3. Restore tenant metadata in registry if present
            if (parsed.tenant) {
                const registry = await getTenantRegistry();
                const idx = registry.findIndex(t => t.slug === targetSlug);
                if (idx !== -1) {
                    registry[idx] = {
                        ...registry[idx],
                        name: parsed.tenant.name || registry[idx].name,
                        brand_color: parsed.tenant.brand_color || registry[idx].brand_color,
                        logo_url: parsed.tenant.logo_url || registry[idx].logo_url,
                        office_name: parsed.tenant.office_name || registry[idx].office_name,
                        latitude: parsed.tenant.latitude || registry[idx].latitude,
                        longitude: parsed.tenant.longitude || registry[idx].longitude,
                        radius: parsed.tenant.radius || registry[idx].radius,
                        plan_tier: parsed.tenant.plan_tier || registry[idx].plan_tier
                    };
                    await saveTenantRegistry(registry);
                }
            }

            if (statusEl) {
                statusEl.textContent = 'Workspace archive restored successfully!';
                statusEl.style.color = 'var(--success)';
            }
            showToast(`Workspace archive successfully restored for ${targetSlug}!`, 'success');
            await openTenantMasterModal(targetSlug);
            await loadFleetData();
        } catch (err) {
            console.error('Import error:', err);
            if (statusEl) {
                statusEl.textContent = `Restore failed: ${err.message}`;
                statusEl.style.color = 'var(--danger)';
            }
            showToast(`Restore failed: ${err.message}`, 'error');
        }
    };

    reader.readAsText(file);
}

function openMasterKeyModal() {
    const modal = document.getElementById('master-key-modal');
    if (modal) {
        modal.style.display = 'flex';
        const msg = document.getElementById('master-key-change-msg');
        if (msg) msg.style.display = 'none';
        const form = document.getElementById('master-key-change-form');
        if (form) form.reset();
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }
}

function closeMasterKeyModal() {
    const modal = document.getElementById('master-key-modal');
    if (modal) modal.style.display = 'none';
}

async function handleSaveMasterKey(e) {
    e.preventDefault();
    const currentInput = document.getElementById('current-master-key-input');
    const newInput = document.getElementById('new-master-key-input');
    const confirmInput = document.getElementById('confirm-master-key-input');
    const msgEl = document.getElementById('master-key-change-msg');
    const btn = document.getElementById('btn-save-master-key');

    const currentVal = (currentInput.value || '').trim();
    const newVal = (newInput.value || '').trim();
    const confirmVal = (confirmInput.value || '').trim();

    msgEl.style.display = 'none';

    // Verify current key
    const isCurrentValid = await verifyMasterKey(currentVal);
    if (!isCurrentValid) {
        msgEl.textContent = 'Current master key is incorrect.';
        msgEl.style.color = 'var(--danger)';
        msgEl.style.display = 'block';
        return;
    }

    if (newVal.length < 8) {
        msgEl.textContent = 'New master key must be at least 8 characters.';
        msgEl.style.color = 'var(--danger)';
        msgEl.style.display = 'block';
        return;
    }

    if (newVal !== confirmVal) {
        msgEl.textContent = 'New master keys do not match.';
        msgEl.style.color = 'var(--danger)';
        msgEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
        const newHash = await sha256Hex(newVal);
        const res = await callBackend({
            mode: 'update-config',
            key: 'SUPER_ADMIN_MASTER_KEY_HASH',
            value: newHash
        });

        if (res.ok) {
            sessionStorage.setItem('active_master_key_secret', newVal);
            msgEl.textContent = 'Master Platform Key successfully updated!';
            msgEl.style.color = 'var(--success)';
            msgEl.style.display = 'block';
            setTimeout(() => {
                closeMasterKeyModal();
            }, 1200);
        } else {
            msgEl.textContent = res.message || 'Failed to update master key.';
            msgEl.style.color = 'var(--danger)';
            msgEl.style.display = 'block';
        }
    } catch (err) {
        msgEl.textContent = 'Error saving new master key.';
        msgEl.style.color = 'var(--danger)';
        msgEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Update Master Key';
    }
}

async function handlePurgeTenantLogs() {
    if (!activeMasterTenantSlug) return;
    const promptVal = prompt(`WARNING: This will delete all recorded attendance records for ${activeMasterTenantSlug}.\nType PURGE to confirm:`);
    if (promptVal !== 'PURGE') return;

    const res = await callBackend({
        mode: 'super-admin-purge-tenant-logs',
        slug: activeMasterTenantSlug
    });
    showToast(res.message || 'Attendance history purged.', 'success');
}

async function handleDeleteTenantWorkspace() {
    if (!activeMasterTenantSlug) return;
    const promptVal = prompt(`CRITICAL: This permanently deletes workspace "${activeMasterTenantSlug}", including all staff and configuration.\nType "${activeMasterTenantSlug}" to confirm deletion:`);
    if (promptVal !== activeMasterTenantSlug) {
        showToast('Confirmation did not match. Workspace was NOT deleted.', 'warning');
        return;
    }

    const res = await callBackend({
        mode: 'super-admin-delete-tenant',
        slug: activeMasterTenantSlug
    });

    if (res.ok) {
        showToast(res.message || 'Operation successful', 'success');
        closeTenantMasterModal();
        await loadFleetData();
    } else {
        showToast(res.message || 'Failed to delete tenant.', 'error');
    }
}

async function loadGlobalActivityFeed() {
    const stream = document.getElementById('activity-stream');
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient
            .from('attendance')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(8);

        if (!error && data && data.length) {
            stream.innerHTML = data.map(item => {
                const time = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const date = new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
                const actionBadge = item.action === 'checkin' || item.action === 'IN' 
                    ? '<span style="color:var(--success);"><i data-lucide="check-circle" size="13" style="vertical-align:middle; margin-right:2px;"></i> Check-In</span>' 
                    : '<span style="color:var(--warning);"><i data-lucide="log-out" size="13" style="vertical-align:middle; margin-right:2px;"></i> Check-Out</span>';

                return `
                    <div class="feed-item">
                        <div class="feed-header">
                            <span class="feed-tenant">${escapeHtml(item.tenant_slug || 'Global')}</span>
                            <span class="feed-time">${date} ${time}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div class="feed-staff">${escapeHtml(item.name)}</div>
                            <span style="font-size:0.75rem; font-weight:700;">${actionBadge}</span>
                        </div>
                    </div>
                `;
            }).join('');
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        } else {
            stream.innerHTML = '<div class="empty-feed">No check-in logs recorded yet.</div>';
        }
    } catch (e) {
        stream.innerHTML = '<div class="empty-feed">Activity feed offline.</div>';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Modal tabs horizontal wheel scrolling
document.addEventListener('DOMContentLoaded', () => {
    const tabsStrip = document.getElementById('modal-tabs-strip');
    if (tabsStrip) {
        tabsStrip.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                tabsStrip.scrollBy({ left: e.deltaY, behavior: 'smooth' });
            }
        }, { passive: false });
    }
});
