/**
 * Shared utilities for Lifecard Staff Attendance.
 * Loaded by both index.html and admin/index.html.
 */

const STORAGE_KEYS = {
    pendingQueue: 'attendance_pending_queue',
    recentLog: 'attendance_recent_log',
    lastSynced: 'attendance_last_synced',
    lastAction: 'attendance_last_action',
    pendingAction: 'attendance_pending_action',
    theme: 'attendance_theme',
    deviceLock: 'attendance_device_lock',
    analytics: 'attendance_analytics'
};

// Supabase Initialization
const supabaseUrl = 'https://akhditjeiwjuzvubnacw.supabase.co';
const supabaseKey = 'sb_publishable_9BkVRtmi-6UG15Va5xNHbw_R7J_hKhi';
const supabaseClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
        experimental: { passkey: true }
    }
}) : null;


/* ---------- HTML Escaping & Date Utilities ---------- */

function formatWeekKeyFromDmy(dmyStr) {
    if (!dmyStr) return dmyStr;
    if (dmyStr.includes('-') || dmyStr.includes(',')) return dmyStr;
    const parts = dmyStr.split('/');
    if (parts.length !== 3) return dmyStr;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const monday = new Date(year, month, day);
    const friday = new Date(year, month, day + 4);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monMonth = monthNames[monday.getMonth()];
    const friMonth = monthNames[friday.getMonth()];
    // Always include both month names to match GAS-saved keys: "July 27 - July 31, 2026"
    return `${monMonth} ${monday.getDate()} - ${friMonth} ${friday.getDate()}, ${year}`;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ---------- Analytics/Monitoring ---------- */

function logAnalyticsEvent(type, details = {}) {
    const analytics = readStoredJson(STORAGE_KEYS.analytics, []);
    const event = {
        type,
        details,
        timestamp: new Date().toISOString()
    };
    analytics.unshift(event);
    writeStoredJson(STORAGE_KEYS.analytics, analytics.slice(0, 100));

    if (navigator.onLine) {
        const deviceId = typeof window._deviceId !== 'undefined' ? window._deviceId : '';
        const detailStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
        callBackend({ mode: 'log-analytics', eventType: type, details: detailStr, deviceId }).catch(() => {});
    }
}

function getAnalytics() {
    return readStoredJson(STORAGE_KEYS.analytics, []);
}

function clearAnalytics() {
    writeStoredJson(STORAGE_KEYS.analytics, []);
}


/* ---------- Safe Storage Wrapper ---------- */
window.safeStorage = {
    getItem: (key) => { try { return localStorage.getItem(key); } catch(e) { return null; } },
    setItem: (key, val) => { try { localStorage.setItem(key, val); } catch(e) {} },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch(e) {} }
};

window.safeSession = {
    getItem: (key) => { try { return sessionStorage.getItem(key); } catch(e) { return null; } },
    setItem: (key, val) => { try { sessionStorage.setItem(key, val); } catch(e) {} },
    removeItem: (key) => { try { sessionStorage.removeItem(key); } catch(e) {} }
};

/* ---------- Storage helpers ---------- */

function readStoredJson(key, fallback = []) {
    try {
        const value = safeStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.warn(`Failed to parse stored value for "${key}":`, error);
        return fallback;
    }
}

function writeStoredJson(key, value) {
    try {
        safeStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Failed to persist value for "${key}":`, error);
    }
}

/* ---------- Crypto: SHA-256 hashing ---------- */

async function sha256Hex(text) {
    if (!window.crypto || !window.crypto.subtle) {
        throw new Error('Web Crypto API is unavailable in this browser context (requires HTTPS or localhost).');
    }
    const data = new TextEncoder().encode(text);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/* ---------- Request deduplication ---------- */

const pendingRequests = new Map();

async function callBackendDeduplicated(payload, timeoutMs = 20000) {
    const requestKey = JSON.stringify(payload);
    
    if (pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }
    
    const promise = callBackend(payload, timeoutMs)
        .finally(() => {
            pendingRequests.delete(requestKey);
        });
    
    pendingRequests.set(requestKey, promise);
    return promise;
}

/* ---------- Backend communication ----------
   Routes requests to Supabase (PostgreSQL + Edge RPCs). */

async function callBackend(payload, timeoutMs = 20000) {
    if (!supabaseClient) return { ok: false, message: 'Supabase client not loaded.' };
    const adminToken = payload.adminToken || safeSession.getItem('admin_token') || '';
    const mode = payload.mode;
    
    try {
        switch (mode) {
            case 'admin-login': {
                // True Supabase Auth Login
                const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                    email: payload.email,
                    password: payload.password
                });
                if (authError) throw authError;
                
                // Fetch their role from admin_roles
                const { data: roleData, error: roleError } = await supabaseClient.from('admin_roles').select('role').eq('id', authData.user.id).single();
                if (roleError) throw roleError;

                return {
                    ok: true,
                    message: 'Admin access granted.',
                    role: roleData.role,
                    isSuperuser: roleData.role === 'developer',
                    username: payload.email
                };
            }
            case 'admin-logout': {
                await supabaseClient.auth.signOut();
                return { ok: true, message: 'Logged out.' };
            }
            case 'attendance': {
                const { data, error } = await supabaseClient.rpc('process_attendance', {
                    p_name: payload.name,
                    p_action: payload.action,
                    p_lat: payload.lat,
                    p_lon: payload.lon,
                    p_device_id: payload.deviceId || ''
                });
                if (error) throw error;
                return {
                    ok: data.ok,
                    allowed: data.ok,
                    message: data.message,
                    status: data.status,
                    distance: data.distance,
                    raw: data
                };
            }
            case 'list-staff': {
                const { data, error } = await supabaseClient.from('staff').select('*').order('name');
                if (error) throw error;
                return { ok: true, allowed: true, staff: data };
            }
            case 'list-logs': {
                let query = supabaseClient.from('attendance_logs').select('*');
                if (payload.name) {
                    query = query.ilike('name', `%${payload.name}%`);
                }
                if (payload.fromDate) {
                    query = query.gte('date', payload.fromDate);
                }
                if (payload.toDate) {
                    query = query.lte('date', payload.toDate);
                }
                query = query.order('created_at', { ascending: false }).limit(payload.limit || 500);
                const { data, error } = await query;
                if (error) throw error;
                return { ok: true, allowed: true, logs: data };
            }
            case 'list-distance-alerts': {
                const { data, error } = await supabaseClient.from('distance_alerts').select('*').order('id', { ascending: false }).limit(200);
                if (error) throw error;
                return { ok: true, allowed: true, alerts: data };
            }
            case 'list-audit-logs':
            case 'list-analytics': {
                const { data, error } = await supabaseClient.from('audit_logs').select('*').order('id', { ascending: false }).limit(200);
                if (error) throw error;
                return { ok: true, allowed: true, events: data };
            }
            case 'log-analytics': {
                // Not strictly necessary for core function, but we can log it
                const { error } = await supabaseClient.from('audit_logs').insert([{
                    date: new Date().toLocaleDateString(),
                    time: new Date().toLocaleTimeString(),
                    category: 'Analytics',
                    event_type: payload.eventType,
                    user_staff: payload.deviceId || 'System',
                    details: payload.details
                }]);
                if (error) throw error;
                return { ok: true, message: 'Logged' };
            }
            case 'add-staff': {
                const { error } = await supabaseClient.from('staff').insert([{ name: payload.name }]);
                if (error) throw error;
                return { ok: true, message: 'Staff added successfully.' };
            }
            case 'remove-staff': {
                const { error } = await supabaseClient.from('staff').delete().eq('name', payload.name);
                if (error) throw error;
                return { ok: true, message: 'Staff removed successfully.' };
            }
            case 'reset-staff-lock': {
                const { error } = await supabaseClient.from('staff').update({ device_id: null }).eq('name', payload.name);
                if (error) throw error;
                return { ok: true, message: 'Device lock reset.' };
            }
            case 'reset-all-locks': {
                // Supabase doesn't easily allow update all without a filter if RLS is tricky, but we can do neq
                const { error } = await supabaseClient.from('staff').update({ device_id: null }).neq('name', 'invalid_dummy_name_123');
                if (error) throw error;
                return { ok: true, message: 'All device locks reset.' };
            }
            case 'get-config': {
                const { data, error } = await supabaseClient.from('app_config').select('*');
                if (error) throw error;
                const configObj = {};
                data.forEach(row => configObj[row.key] = row.value);
                return { ok: true, config: configObj };
            }
            case 'update-config': {
                const { error } = await supabaseClient.from('app_config').update({ value: payload.value }).eq('key', payload.key);
                if (error) throw error;
                return { ok: true, message: 'Configuration updated.' };
            }
            case 'list-admin-users': {
                const { data, error } = await supabaseClient.from('admin_roles').select('*');
                if (error) throw error;
                return { ok: true, users: data || [] };
            }
            case 'add-admin-user': {
                const username = (payload.newUsername || payload.username || '').trim();
                const email = (payload.email || `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@lifecard.local`).trim();
                const password = payload.password || payload.newPassword || 'AdminPass123!';
                const role = payload.role || payload.tier || 'admin';

                // Save current admin session BEFORE signUp (signUp logs in as the new user)
                const { data: currentSessionData } = await supabaseClient.auth.getSession();
                const currentSession = currentSessionData?.session;

                const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                    email: email,
                    password: password
                });
                if (authError) throw authError;

                // Restore original admin session immediately so insert runs as the superuser
                if (currentSession) {
                    await supabaseClient.auth.setSession({
                        access_token: currentSession.access_token,
                        refresh_token: currentSession.refresh_token
                    });
                }

                if (authData && authData.user) {
                    const { error: roleError } = await supabaseClient.from('admin_roles').upsert([{
                        id: authData.user.id,
                        role: role,
                        email: email,
                        username: username
                    }], { onConflict: 'id' });
                    if (roleError && roleError.code !== '23505') throw roleError;
                }
                return { ok: true, message: 'Admin user created successfully!' };
            }
            case 'remove-admin-user': {
                const target = payload.targetUsername || payload.userId;
                // Only include id filter if target looks like a UUID (avoid cast error)
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
                let delQuery = supabaseClient.from('admin_roles').delete();
                if (isUuid) {
                    delQuery = delQuery.or(`id.eq."${target}",username.eq."${target}",email.eq."${target}"`);
                } else {
                    delQuery = delQuery.or(`username.eq."${target}",email.eq."${target}"`);
                }
                const { error } = await delQuery;
                if (error) throw error;
                return { ok: true, message: 'Admin user removed.' };
            }
            case 'update-admin-role': {
                const target = payload.targetUsername;
                const role = payload.newRole || payload.role;
                const { error } = await supabaseClient.from('admin_roles').update({ role }).or(`username.eq."${target}",email.eq."${target}"`);
                if (error) throw error;
                return { ok: true, message: 'Admin role updated successfully.' };
            }
            case 'update-admin-user': {
                const target = payload.targetUsername;
                const updates = {};
                if (payload.newUsername && payload.newUsername.trim()) updates.username = payload.newUsername.trim();
                if (payload.email && payload.email.trim()) updates.email = payload.email.trim();
                if (payload.tier) updates.role = payload.tier;
                if (Object.keys(updates).length > 0) {
                    const { error: updateErr } = await supabaseClient
                        .from('admin_roles')
                        .update(updates)
                        .or(`username.eq."${target}",email.eq."${target}"`);
                    if (updateErr) throw updateErr;
                }
                // Update password if provided
                if (payload.password && payload.password.trim()) {
                    const newPass = payload.password.trim();
                    // Look up auth ID
                    const { data: roleRow } = await supabaseClient
                        .from('admin_roles')
                        .select('id')
                        .or(`username.eq."${payload.newUsername || target}",email.eq."${payload.email || target}"`)
                        .single();
                    if (roleRow) {
                        const authUpdate = supabaseClient.auth.admin
                            ? await supabaseClient.auth.admin.updateUserById(roleRow.id, { password: newPass })
                            : await supabaseClient.auth.updateUser({ password: newPass });
                        if (authUpdate.error) throw authUpdate.error;
                    }
                }
                return { ok: true, message: 'Admin user updated successfully.' };
            }
            case 'admin-reset-user-password':
            case 'reset-admin-password': {
                const targetUser = payload.targetUsername;
                const newPass = payload.newPassword || payload.newPasswordHash;
                if (!newPass) return { ok: false, message: 'No new password provided.' };
                // Look up the user\'s auth ID from admin_roles
                const { data: roleRow } = await supabaseClient
                    .from('admin_roles')
                    .select('id, email')
                    .or(`username.eq."${targetUser}",email.eq."${targetUser}"`)
                    .single();
                if (!roleRow) return { ok: false, message: 'Admin user not found.' };
                // Use admin client with service_role if available, else fall back to updateUser
                // Since we only have the anon key here, we update via auth.updateUser on behalf
                // of the currently-signed-in superuser (admin action)
                const { error: pwErr } = await supabaseClient.auth.admin
                    ? await supabaseClient.auth.admin.updateUserById(roleRow.id, { password: newPass })
                    : await supabaseClient.auth.updateUser({ password: newPass });
                if (pwErr) throw pwErr;
                return { ok: true, message: 'Password reset successfully.' };
            }
            case 'admin-change-password': {
                const pass = payload.newPassword || payload.newPasswordHash;
                if (pass) {
                    // Make sure the Supabase client's session is fresh before calling updateUser
                    let session = null;
                    try {
                        const { data: sessData } = await supabaseClient.auth.getSession();
                        session = sessData?.session || null;
                    } catch(e) {}
                    if (!session) {
                        // Try a token refresh in case the access token is just expired
                        try {
                            const { data: refreshData } = await supabaseClient.auth.refreshSession();
                            session = refreshData?.session || null;
                        } catch(e) {}
                    }
                    if (!session) {
                        return { ok: false, message: 'No active admin session — please log in again before changing your password.' };
                    }
                    // Re-assert the session so the client sends the correct Bearer token
                    await supabaseClient.auth.setSession({
                        access_token: session.access_token,
                        refresh_token: session.refresh_token
                    });
                    const { error } = await supabaseClient.auth.updateUser({ password: pass });
                    if (error) throw error;
                }
                return { ok: true, message: 'Password updated successfully!' };
            }
            case 'admin-set-recovery-email': {
                const email = payload.email;
                if (email) {
                    await supabaseClient.from('app_config').upsert([{ key: 'RECOVERY_EMAIL', value: email }], { onConflict: 'key' });
                    const { data: userData } = await supabaseClient.auth.getUser();
                    if (userData && userData.user) {
                        await supabaseClient.from('admin_roles').update({ email: email }).eq('id', userData.user.id);
                    }
                }
                return { ok: true, message: 'Recovery email saved successfully.' };
            }
            case 'get-recovery-email': {
                let email = null;
                try {
                    const { data: userData } = await supabaseClient.auth.getUser();
                    if (userData && userData.user) {
                        const { data: rData } = await supabaseClient.from('admin_roles').select('email').eq('id', userData.user.id).single();
                        if (rData && rData.email) email = rData.email;
                    }
                } catch(e) {}
                if (!email) {
                    const { data: cfg } = await supabaseClient.from('app_config').select('value').eq('key', 'RECOVERY_EMAIL').single();
                    if (cfg && cfg.value) email = cfg.value;
                }
                return { ok: true, email: email };
            }
            case 'admin-forgot-password-request': {
                if (payload.username && payload.username.includes('@')) {
                    await supabaseClient.auth.resetPasswordForEmail(payload.username);
                }
                return { ok: true, message: 'Password reset request processed.' };
            }
            case 'admin-forgot-password-confirm': {
                if (payload.newPasswordHash || payload.newPassword) {
                    await supabaseClient.auth.updateUser({ password: payload.newPassword || payload.newPasswordHash });
                }
                return { ok: true, message: 'Password reset successful.' };
            }
            case 'get-hybrid-schedule': {
                const rawKey = payload.weekStart;
                const formattedKey = formatWeekKeyFromDmy(rawKey);
                // Build all candidate formats to try
                const candidates = [formattedKey, rawKey];
                // Also try the short-form (no second month name) for legacy data
                if (formattedKey !== rawKey) {
                    const parts2 = formattedKey.split(' - ');
                    if (parts2.length === 2) {
                        const shortEnd = parts2[1].replace(/^\w+ /, '');
                        candidates.push(`${parts2[0]} - ${shortEnd}`);
                    }
                }

                let scheduleData = null;
                // Try exact match on each candidate key
                for (const key of candidates) {
                    const { data, error } = await supabaseClient
                        .from('hybrid_schedules')
                        .select('schedule_data, week_key')
                        .eq('week_key', key)
                        .limit(1);
                    if (!error && data && data.length) {
                        scheduleData = data[0].schedule_data;
                        break;
                    }
                }

                // Fallback: fetch recent rows and fuzzy-match the week_key by year + month
                if (!scheduleData) {
                    const year = formattedKey.match(/(\d{4})/)?.[1];
                    const monName = formattedKey.split(' ')[0];
                    if (year && monName) {
                        const { data: allRows } = await supabaseClient
                            .from('hybrid_schedules')
                            .select('schedule_data, week_key')
                            .order('week_key', { ascending: false })
                            .limit(20);
                        const match = (allRows || []).find(r =>
                            r.week_key && r.week_key.includes(year) && r.week_key.includes(monName)
                        );
                        if (match) scheduleData = match.schedule_data;
                    }
                }

                if (!scheduleData) {
                    return { ok: true, allowed: true, schedule: {} };
                }

                let parsedSchedule = scheduleData;
                if (typeof parsedSchedule === 'string') {
                    try { parsedSchedule = JSON.parse(parsedSchedule); } catch(e) {}
                }
                return { ok: true, allowed: true, schedule: parsedSchedule };
            }
            case 'save-hybrid-schedule':
            case 'update-hybrid-schedule': {
                const { error } = await supabaseClient
                    .from('hybrid_schedules')
                    .upsert({
                        week_key: payload.weekStart,
                        schedule_data: payload.scheduleData || payload.schedule,
                        timestamp: new Date().toISOString()
                    }, { onConflict: 'week_key' });
                if (error) throw error;
                return { ok: true, message: 'Hybrid schedule saved.' };
            }
            case 'claim-account': {
                const { data, error } = await supabaseClient.rpc('claim_account', {
                    p_name: payload.name,
                    p_device_id: payload.deviceId || ''
                });
                if (error) throw error;
                return {
                    ok: data.ok,
                    allowed: data.ok,
                    email: data.email,
                    password: data.password,
                    message: data.message
                };
            }
            case 'verify-owner':
            case 'verify-user': {
                const { data, error } = await supabaseClient.from('staff').select('device_id').eq('name', payload.name).single();
                if (error) return { ok: false, allowed: false, message: 'Staff member not found.' };
                if (!data.device_id) return { ok: true, allowed: true, message: 'No device locked yet.' };
                if (data.device_id === payload.deviceId) return { ok: true, allowed: true, message: 'Device verified.' };
                
                // If it doesn't match, we need to return the conflictOwner name so the UI can display it
                // We don't store owner name on the device, we store device on the owner. 
                // So let's find who owns this device.
                const { data: conflictData } = await supabaseClient.from('staff').select('name').eq('device_id', payload.deviceId).single();
                const conflictOwner = conflictData ? conflictData.name : 'another user';
                return { ok: false, allowed: false, message: `This device is already registered to ${conflictOwner}. Device sharing is not allowed.` };
            }
            case 'register-owner': {
                // Read current device_id
                const { data, error } = await supabaseClient.from('staff').select('device_id').eq('name', payload.name).single();
                if (error) return { ok: false, allowed: false, message: 'Staff member not found.' };
                
                // If already registered to this device, success
                if (data.device_id === payload.deviceId) return { ok: true, allowed: true };
                
                // If registered to a DIFFERENT device, fail
                if (data.device_id) return { ok: false, allowed: false, message: 'Already registered to another device.' };
                
                // Otherwise, register it
                const { error: updateError } = await supabaseClient.from('staff').update({ device_id: payload.deviceId }).eq('name', payload.name);
                if (updateError) throw updateError;
                return { ok: true, allowed: true, message: 'Device registered successfully.' };
            }
            case 'reassign-owner': {
                // Check if the resetCodeHash matches the dev or admin password
                // This is a bit tricky without a backend, but we'll try to validate it
                // Actually, the original GAS implementation checked if `payload.resetCodeHash` matched `accounts[..].passwordHash`
                // For Supabase, the admin would normally use the admin dashboard to reset locks.
                // If the user tries to do it from the frontend via reassign-owner, let's just let the admin dashboard handle it via `reset-staff-lock`.
                // The frontend `reassignDeviceOwnership` is a fallback that might not be fully needed since admin panel works.
                // Let's implement it by checking if the resetCode matches a config value or just reject it and tell them to see admin.
                return { ok: false, allowed: false, message: 'Please see the administrator to reset your device lock.' };
            }
            default:
                // For unmapped endpoints, return false so the UI knows it's not implemented yet
                return { ok: false, allowed: false, message: `Endpoint '${mode}' is not implemented in Supabase yet.` };
        }
    } catch (err) {
        console.error('Supabase Error:', err);
        return { ok: false, allowed: false, message: err.message || 'Database error.' };
    }
}

function normalizeBackendResponse(data) {
    if (!data) return { ok: false, allowed: false, message: 'No response from backend.', raw: null };
    if (data.result !== undefined) {
        const normalized = normalizeBackendResponse(data.result);
        if (normalized.raw === null && typeof data.result === 'string') {
            normalized.raw = data.result;
        }
        return normalized;
    }
    if (typeof data === 'string') {
        const parts = data.split('|');
        const isSuccess = ['WELCOME', 'LATE', 'NORMAL'].includes(parts[0]);
        return { ok: isSuccess, allowed: isSuccess, message: parts[1] || data, raw: data };
    }
    return {
        ok: data.ok === true || data.allowed === true,
        allowed: data.allowed === true || data.ok === true,
        message: data.message || data.result || 'Backend response received.',
        staff: data.staff || null,
        owner: data.owner || data.deviceOwner || null,
        logs: data.logs || null,
        config: data.config || null,
        schedule: data.schedule || null,
        csrfToken: data.csrfToken || null,
        adminToken: data.adminToken || null,
        raw: null
    };
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
    const root = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    const isDark = theme === 'dark';
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (toggle) {
        toggle.textContent = isDark ? 'Light' : 'Dark';
        toggle.setAttribute('aria-pressed', String(isDark));
        toggle.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
    try {
        safeStorage.setItem(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');
    } catch (e) {
        console.warn('localStorage not available:', e);
    }
}

function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    
    let saved = null;
    try {
        saved = safeStorage.getItem(STORAGE_KEYS.theme);
    } catch (e) {
        console.warn('localStorage not available:', e);
    }
    
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved === 'dark' || (!saved && prefersDark) ? 'dark' : 'light');
    
    toggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
    });
}

/* ---------- Hard refresh ---------- */

async function hardRefresh() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
    }
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((reg) => reg.unregister()));
        }
        if (window.caches && caches.keys) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
        }
    } catch (error) {
        console.warn('Error clearing service worker/cache during refresh:', error);
    } finally {
        window.location.reload();
    }
}

function initRefreshButton() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', hardRefresh);
    }
}

/* ---------- Show/hide password toggle ---------- */

function initPasswordToggle(toggleEl) {
    const targetId = toggleEl.getAttribute('data-toggle-target');
    const input = document.getElementById(targetId);
    if (!input || toggleEl.dataset.toggleBound) return;
    toggleEl.dataset.toggleBound = 'true';

    const syncToggleState = () => {
        const isHidden = input.type === 'password';
        toggleEl.textContent = isHidden ? '👁' : '🙈';
        toggleEl.setAttribute('aria-label', isHidden ? 'Show password' : 'Hide password');
        toggleEl.classList.toggle('visible', !isHidden);
    };

    syncToggleState();
    toggleEl.addEventListener('click', () => {
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        syncToggleState();
    });
}

function initAllPasswordToggles(root = document) {
    root.querySelectorAll('[data-toggle-target]').forEach(initPasswordToggle);
}

/* ---------- Formatting ---------- */

function formatTimestamp(isoString) {
    if (!isoString) return 'Pending';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDateDisplay(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getTodayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/* ---------- Toast notifications ---------- */

let toastTimer = null;

function showToast(message, type = 'default', durationMs = 3200) {
    let toastEl = document.getElementById('app-toast');
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'app-toast';
        toastEl.className = 'toast';
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.className = `toast visible${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastEl.classList.remove('visible');
    }, durationMs);
}

/* ---------- Inline dialog ---------- */

function showInlineDialog({ title, message, fields = [], confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, customContentHtml = '' }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        const fieldsHtml = fields.map((field, idx) => {
            const inputId = `dialog-field-${idx}`;
            const labelHtml = field.label ? `<label for="${inputId}" style="display:block; font-size:0.78rem; font-weight:600; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.04em;">${escapeHtml(field.label)}</label>` : '';
            if (field.type === 'select') {
                const optionsHtml = (field.options || []).map(opt => `
                    <option value="${escapeHtml(opt.value)}" ${field.value === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
                `).join('');
                return `
                    <div style="margin-bottom:12px;">
                        ${labelHtml}
                        <select id="${inputId}" class="dialog-select" style="width:100%; padding:8px 12px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:0.88rem;">
                            ${optionsHtml}
                        </select>
                    </div>
                `;
            }

            const prefilledValue = (field.value !== undefined && field.value !== null) ? escapeHtml(String(field.value)) : '';
            const input = `
                <input
                    id="${inputId}"
                    type="${field.type || 'text'}"
                    placeholder="${escapeHtml(field.placeholder || '')}"
                    autocomplete="${field.autocomplete || 'off'}"
                    value="${prefilledValue}"
                />
            `;
            if (field.type === 'password') {
                return `
                    <div style="margin-bottom:12px;">
                        ${labelHtml}
                        <div class="password-field-wrap" style="margin-bottom:0;">
                            ${input}
                            <button type="button" class="password-toggle" data-toggle-target="${inputId}" aria-label="Show password">👁</button>
                        </div>
                    </div>
                `;
            }
            return `<div style="margin-bottom:12px;">${labelHtml}${input}</div>`;
        }).join('');
        overlay.innerHTML = `
            <div class="dialog-box">
                <h3>${escapeHtml(title)}</h3>
                ${message ? `<p style="color:var(--text-muted); font-size:0.88rem; margin-bottom:14px;">${escapeHtml(message)}</p>` : ''}
                ${fieldsHtml}
                ${customContentHtml}
                <div class="dialog-actions">
                    <button type="button" class="admin-btn secondary" data-action="cancel">${escapeHtml(cancelLabel)}</button>
                    <button type="button" class="admin-btn${danger ? ' danger' : ''}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        initAllPasswordToggles(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(null));
        overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
            const values = fields.map((field, idx) => {
                const raw = overlay.querySelector(`#dialog-field-${idx}`).value;
                return field.type === 'password' ? raw : raw.trim();
            });
            // Only require non-empty for fields that are not optional
            const missingRequired = fields.some((field, idx) => !field.optional && !values[idx]);
            if (fields.length && missingRequired) {
                showToast('Please fill in all required fields.', 'error');
                return;
            }
            // Capture all custom select/input values before overlay removal
            const customSelects = overlay.querySelectorAll('select');
            customSelects.forEach(sel => {
                if (sel.id) window['_dialogVal_' + sel.id] = sel.value;
            });
            cleanup(fields.length ? values : true);
        });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup(null);
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') cleanup(null);
        });

        const firstInput = overlay.querySelector('input');
        if (firstInput) firstInput.focus();
    });
}

function confirmDialog(message, { danger = false, confirmLabel = 'Confirm', title = 'Please confirm' } = {}) {
    return showInlineDialog({ title, message, confirmLabel, danger }).then((result) => result === true);
}

function promptDialog(title, placeholder = '', type = 'text') {
    return showInlineDialog({ title, fields: [{ placeholder, type }] }).then((result) => (result ? result[0] : null));
}
