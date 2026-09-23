// Safely obtain Supabase client reference without redeclaring globals
const hybridSupabaseClient = (typeof window !== 'undefined' && window.supabaseClient)
    ? window.supabaseClient
    : ((typeof supabaseClient !== 'undefined')
        ? supabaseClient
        : (window.supabase ? window.supabase.createClient(
            (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || 'https://akhditjeiwjuzvubnacw.supabase.co',
            (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_KEY) || 'sb_publishable_9BkVRtmi-6UG15Va5xNHbw_R7J_hKhi'
          ) : null));


const urlParams = new URLSearchParams(window.location.search);
const activeTenantSlug = (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : null) || urlParams.get('tenant') || 'lifecard';

const STORAGE_KEY = `chckpoint-hybrid-schedule-${activeTenantSlug}`;
const HISTORY_STORAGE_KEY = `chckpoint-hybrid-history-${activeTenantSlug}`;

// Admin Mode check: active admin session or explicit admin key parameter
const hasAdminSession = Boolean(
    sessionStorage.getItem(`chckpoint_admin_unlocked_${activeTenantSlug}`) || 
    sessionStorage.getItem('admin_session') ||
    sessionStorage.getItem('admin_token')
);
const IS_ADMIN = hasAdminSession || urlParams.get('key') === 'admin';

let ALL_STAFF = [];
let STAFF = [];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

let currentWeekKey = "";
let currentData = {};
let draggedItem = null;
let currentDeptFilter = "all";

/* ============================================================
   TENANT BRANDING & HEADER SETUP
   ============================================================ */

async function initTenantHybridBranding() {
    try {
        let tenant = null;
        if (typeof getTenantConfig === 'function') {
            tenant = await getTenantConfig(activeTenantSlug);
        }
        const companyName = tenant?.name || (activeTenantSlug.charAt(0).toUpperCase() + activeTenantSlug.slice(1));
        const titleEl = document.getElementById('page-brand-title');
        if (titleEl) titleEl.textContent = `${companyName} Hybrid Schedule`;
        document.title = `${companyName} Hybrid Schedule | Chckpoint`;
    } catch(e) {
        console.warn('Error applying tenant hybrid branding:', e);
    }
}

/* ============================================================
   STAFF DATA LOADING (TENANT-SCOPED, NO HARDCODED NAMES)
   ============================================================ */

async function loadDynamicStaff() {
    try {
        let tenantStaff = [];
        if (typeof getTenantStaffList === 'function') {
            tenantStaff = await getTenantStaffList(activeTenantSlug);
        }

        if ((!tenantStaff || !tenantStaff.length) && hybridSupabaseClient) {
            try {
                let query = hybridSupabaseClient.from('staff').select('*');
                if (activeTenantSlug === 'lifecard') {
                    query = query.or('tenant_slug.eq.lifecard,tenant_slug.is.null');
                } else {
                    query = query.eq('tenant_slug', activeTenantSlug);
                }
                const { data } = await query.order('name');
                if (data && data.length) tenantStaff = data;
            } catch(e) {}
        }

        if (tenantStaff && tenantStaff.length) {
            ALL_STAFF = tenantStaff
                .filter(s => {
                    const pol = String(s.schedule_policy || '').toLowerCase();
                    return pol === 'weekly_hybrid' || !pol || pol === 'hybrid';
                })
                .map(s => ({
                    name: String(s.name || '').trim(),
                    dept: String(s.dept || 'General').trim(),
                    is_team_lead: Boolean(s.is_team_lead)
                }));
        }

        // Sort leads first, then alphabetically by name
        ALL_STAFF.sort((a, b) => {
            if (a.is_team_lead && !b.is_team_lead) return -1;
            if (!a.is_team_lead && b.is_team_lead) return 1;
            return a.name.localeCompare(b.name);
        });

        applyDepartmentFilter();
        populateDepartmentFilterDropdown();
    } catch (e) {
        console.warn('Could not load dynamic staff for hybrid schedule:', e);
    }
}

function populateDepartmentFilterDropdown() {
    const select = document.getElementById('dept-filter-select');
    if (!select) return;

    const depts = Array.from(new Set(ALL_STAFF.map(s => s.dept).filter(Boolean))).sort();
    select.innerHTML = '<option value="all">All Departments</option>';
    depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        select.appendChild(opt);
    });
}

function filterByDepartment(dept) {
    currentDeptFilter = dept || 'all';
    applyDepartmentFilter();
    renderTable();
}

function applyDepartmentFilter() {
    if (currentDeptFilter === 'all') {
        STAFF = [...ALL_STAFF];
    } else {
        STAFF = ALL_STAFF.filter(s => s.dept.toLowerCase() === currentDeptFilter.toLowerCase());
    }
}

/* ============================================================
   SCHEDULE DATA STRUCTURES & PERSISTENCE
   ============================================================ */

function createDefaultScheduleData() {
    const data = {};
    ALL_STAFF.forEach(s => {
        data[s.name] = { Monday: "Office", Tuesday: "Home", Wednesday: "Home", Thursday: "Home", Friday: "Home" };
    });
    return data;
}

function ensureScheduleData(data) {
    const normalized = data && typeof data === 'object' ? data : {};
    const fallback = createDefaultScheduleData();

    ALL_STAFF.forEach(person => {
        if (!normalized[person.name] || typeof normalized[person.name] !== 'object') {
            normalized[person.name] = { ...fallback[person.name] };
        }
        DAYS.forEach(day => {
            if (!normalized[person.name][day]) {
                normalized[person.name][day] = fallback[person.name] ? fallback[person.name][day] : "Home";
            }
        });
    });

    return normalized;
}

function getScopedWeekKey(rawKey) {
    if (!rawKey) return '';
    return rawKey.startsWith(`${activeTenantSlug}::`) ? rawKey : `${activeTenantSlug}::${rawKey}`;
}

function getUnscopedWeekKey(scopedKey) {
    if (!scopedKey) return '';
    const prefix = `${activeTenantSlug}::`;
    return scopedKey.startsWith(prefix) ? scopedKey.slice(prefix.length) : scopedKey;
}

function getWeekRange(offset = 0) {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + (offset * 7);
    const monday = new Date(now.setDate(diff));
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${m[monday.getMonth()]} ${monday.getDate()} - ${m[friday.getMonth()]} ${friday.getDate()}, ${friday.getFullYear()}`;
}

function formatDate(date) {
    const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${m[date.getMonth()]} ${date.getDate()}`;
}

/* ============================================================
   SCHEDULE GENERATOR ALGORITHM
   ============================================================ */

function generateNew() {
    if (!IS_ADMIN) return;

    if (!currentWeekKey) {
        currentWeekKey = getWeekRange(0);
    }
    const targetWeekKey = currentWeekKey;

    const data = {};
    const officeCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 };
    const leadCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 };

    const pool = ALL_STAFF.length ? [...ALL_STAFF] : [...STAFF];

    pool.forEach(person => {
        data[person.name] = { Monday: "Home", Tuesday: "Home", Wednesday: "Home", Thursday: "Home", Friday: "Home" };
        const availableDays = [...DAYS];

        availableDays.sort((a, b) => {
            if (person.is_team_lead) {
                return (leadCount[a] - leadCount[b]) || (officeCount[a] - officeCount[b]);
            }
            return officeCount[a] - officeCount[b];
        });

        const chosenDay = availableDays[0];
        data[person.name][chosenDay] = "Office";
        officeCount[chosenDay]++;
        if (person.is_team_lead) leadCount[chosenDay]++;
    });

    currentData = ensureScheduleData(data);
    renderTable();
    autoSync(targetWeekKey);
}

/* ============================================================
   TABLE RENDERING & DRAG-AND-DROP
   ============================================================ */

function renderTable() {
    const thead = document.getElementById("table-head-days");
    const tbody = document.getElementById("schedule-body");
    const dateRangeEl = document.getElementById("display-date-range");

    if (dateRangeEl) dateRangeEl.innerText = getUnscopedWeekKey(currentWeekKey);

    const parts = getUnscopedWeekKey(currentWeekKey).split(' - ');
    const mondayText = parts[0] || '';
    const fridayText = parts[1] || '';
    const startYearMatch = fridayText.match(/\d{4}$/);
    const startYear = startYearMatch ? parseInt(startYearMatch[0], 10) : new Date().getFullYear();

    const mondayDate = new Date(`${mondayText} ${startYear}`);
    const validDate = !isNaN(mondayDate.getTime());

    thead.innerHTML = `<th>Staff Name</th>`;
    DAYS.forEach((d, idx) => {
        let dateLabel = '';
        if (validDate) {
            const currentDay = new Date(mondayDate);
            currentDay.setDate(mondayDate.getDate() + idx);
            dateLabel = `<br><span style="font-size:0.68rem; font-weight:normal; opacity:0.8;">${formatDate(currentDay)}</span>`;
        }
        thead.innerHTML += `<th>${d}${dateLabel}</th>`;
    });
    thead.innerHTML += `<th class="counter-header" data-html2canvas-ignore>Home Days</th>`;

    tbody.innerHTML = "";

    const activeList = STAFF.length ? STAFF : ALL_STAFF;

    activeList.forEach(person => {
        const tr = document.createElement("tr");

        let star = person.is_team_lead ? ` <span title="Team Lead" style="color:var(--primary); font-size:0.8rem;">★</span>` : "";
        let dept = person.dept ? `<span class="dept-label">${person.dept}</span>` : "";
        let rowHtml = `<td class="name-cell">${person.name}${star}${dept}</td>`;

        DAYS.forEach(day => {
            const status = currentData[person.name] ? currentData[person.name][day] : "Home";
            const statusClass = status === 'Office' ? 'status-office' : status === 'Leave' ? 'status-leave' : 'status-home';

            const draggableAttr = IS_ADMIN ? 'draggable="true"' : '';
            rowHtml += `
                <td>
                    <span class="badge ${statusClass}"
                          ${draggableAttr}
                          data-person="${person.name}"
                          data-day="${day}">
                          ${status}
                    </span>
                </td>`;
        });

        const homeCount = DAYS.filter(d => (currentData[person.name] && currentData[person.name][d] === 'Home')).length;
        const countClass = (homeCount >= 4) ? 'count-ok' : 'count-bad';
        rowHtml += `
            <td class="counter-cell" data-html2canvas-ignore>
                <span class="counter-val ${countClass}">${homeCount}/4</span>
                <span class="counter-label">Days</span>
            </td>`;

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });

    if (IS_ADMIN) attachDragAndDrop();
}

function attachDragAndDrop() {
    const badges = document.querySelectorAll(".badge");
    badges.forEach(b => {
        b.ondragstart = (e) => {
            draggedItem = { person: b.dataset.person, day: b.dataset.day };
            e.dataTransfer.setData("text/plain", "");
        };

        b.ondragover = (e) => e.preventDefault();

        b.ondrop = (e) => {
            e.preventDefault();
            const target = { person: b.dataset.person, day: b.dataset.day };
            if (draggedItem && draggedItem.person === target.person && draggedItem.day !== target.day) {
                const temp = currentData[draggedItem.person][draggedItem.day];
                currentData[draggedItem.person][draggedItem.day] = currentData[target.person][target.day];
                currentData[target.person][target.day] = temp;
                renderTable();
                autoSync(currentWeekKey);
            }
        };
    });
}

/* ============================================================
   CLOUD SYNC & LOCAL CACHING (TENANT SCOPED)
   ============================================================ */

let syncInFlight = false;
async function autoSync(targetWeekKey) {
    if (!IS_ADMIN || syncInFlight) return;
    syncInFlight = true;

    const statusEl = document.getElementById('sync-status');
    if (statusEl) statusEl.innerHTML = `<i data-lucide="refresh-cw" size="12" class="spin"></i> Syncing...`;
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();

    const weekKeyToSend = targetWeekKey || currentWeekKey;
    const scopedKey = getScopedWeekKey(weekKeyToSend);
    const dataToSend = JSON.parse(JSON.stringify(currentData));

    try {
        if (hybridSupabaseClient) {
            const { error } = await hybridSupabaseClient
                .from('hybrid_schedules')
                .upsert({
                    week_key: scopedKey,
                    schedule_data: dataToSend,
                    timestamp: new Date().toISOString()
                }, { onConflict: 'week_key' });

            if (error) throw error;
        }

        if (statusEl) statusEl.innerHTML = `<i data-lucide="cloud-check" size="12"></i> Synced`;
        saveLocalBackup(weekKeyToSend, dataToSend);
        saveLocalHistory({ weekKey: weekKeyToSend, data: dataToSend, timestamp: new Date().toISOString() });
        await loadHistory(false);
    } catch (e) {
        console.warn('autoSync failed, saved locally:', e);
        if (statusEl) statusEl.innerHTML = `<i data-lucide="wifi-off" size="12"></i> Saved locally`;
        saveLocalBackup(weekKeyToSend, dataToSend);
    } finally {
        syncInFlight = false;
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }
}

function saveLocalBackup(weekKey, data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ weekKey, data }));
    } catch (e) {}
}

function getLocalBackup() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        return null;
    }
}

function getLocalHistory() {
    try {
        const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function saveLocalHistory(newEntry) {
    try {
        const history = getLocalHistory();
        const existingIdx = history.findIndex(item => item.weekKey === newEntry.weekKey);
        if (existingIdx !== -1) {
            history[existingIdx] = newEntry;
        } else {
            history.unshift(newEntry);
        }
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 12)));
    } catch (e) {}
}

/* ============================================================
   HISTORY & SCHEDULE RESTORATION
   ============================================================ */

async function loadHistory(updateTable = false) {
    const container = document.getElementById('history-container');
    if (!container) return;

    const localHistory = getLocalHistory();
    const backup = getLocalBackup();

    if (!hybridSupabaseClient) {
        displayLocalHistoryOnly(container, localHistory, backup, updateTable);
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        return;
    }

    try {
        // Query schedules belonging to active tenant
        const { data: dbData, error } = await hybridSupabaseClient
            .from('hybrid_schedules')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(30);

        if (error) throw error;

        const tenantRows = (dbData || []).filter(row => {
            if (!row.week_key) return false;
            return row.week_key.startsWith(`${activeTenantSlug}::`) || (activeTenantSlug === 'lifecard' && !row.week_key.includes('::'));
        });

        const remoteHistory = tenantRows.map(row => ({
            weekKey: getUnscopedWeekKey(row.week_key),
            data: row.schedule_data,
            timestamp: row.timestamp
        }));

        const history = mergeHistory(remoteHistory, localHistory);

        if (updateTable) {
            const currentRange = getWeekRange(0);
            const currentWeekEntry = history.find(item => item.weekKey === currentRange);
            if (currentWeekEntry) {
                currentWeekKey = currentWeekEntry.weekKey;
                currentData = ensureScheduleData(currentWeekEntry.data);
                renderTable();
            } else if (backup && backup.weekKey === currentRange) {
                currentWeekKey = backup.weekKey;
                currentData = ensureScheduleData(backup.data);
                renderTable();
            } else if (IS_ADMIN) {
                generateNew();
            } else {
                const fallback = history[0] || backup;
                if (fallback) {
                    currentWeekKey = fallback.weekKey;
                    currentData = ensureScheduleData(fallback.data);
                    renderTable();
                } else {
                    generateNew();
                }
            }
        }

        renderHistoryCards(container, history);
    } catch (e) {
        console.warn('loadHistory remote fetch error, using local fallback:', e);
        displayLocalHistoryOnly(container, localHistory, backup, updateTable);
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

function mergeHistory(remote, local) {
    const map = new Map();
    remote.forEach(item => map.set(item.weekKey, item));
    local.forEach(item => {
        if (!map.has(item.weekKey)) {
            map.set(item.weekKey, item);
        }
    });
    return Array.from(map.values());
}

function displayLocalHistoryOnly(container, localHistory, backup, updateTable) {
    const history = localHistory.length > 0 ? localHistory : backup ? [backup] : [];

    if (updateTable) {
        const currentRange = getWeekRange(0);
        const currentWeekEntry = history.find(item => item.weekKey === currentRange);
        if (currentWeekEntry) {
            currentWeekKey = currentWeekEntry.weekKey;
            currentData = ensureScheduleData(currentWeekEntry.data);
            renderTable();
        } else if (backup && backup.weekKey === currentRange) {
            currentWeekKey = backup.weekKey;
            currentData = ensureScheduleData(backup.data);
            renderTable();
        } else {
            generateNew();
        }
    }

    renderHistoryCards(container, history);
}

function renderHistoryCards(container, history) {
    container.innerHTML = "";
    if (history.length <= 5) {
        renderSlice(history);
    } else {
        renderSlice(history.slice(0, 4));
        const moreCard = document.createElement('div');
        moreCard.className = 'history-card more-weeks-card';
        moreCard.innerHTML = `<i data-lucide="chevrons-down"></i><div class="history-info">Show More (${history.length - 4})</div>`;
        moreCard.onclick = () => {
            container.innerHTML = "";
            renderSlice(history);
            if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        };
        container.appendChild(moreCard);
    }

    function renderSlice(slice) {
        slice.forEach(item => {
            const card = document.createElement('div');
            card.className = `history-card ${item.weekKey === currentWeekKey ? 'active' : ''}`;
            card.onclick = () => {
                currentWeekKey = item.weekKey;
                currentData = ensureScheduleData(item.data);
                renderTable();
                const allCards = container.querySelectorAll('.history-card');
                allCards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');
            };
            card.innerHTML = `<i data-lucide="calendar"></i><div class="history-info">${item.weekKey}</div>`;
            container.appendChild(card);
        });
    }
}

/* ============================================================
   EXPORT & SHARE (WHATSAPP, GMAIL, DOWNLOAD)
   ============================================================ */

async function downloadImage() {
    const zone = document.getElementById('capture-zone');
    if (!zone || typeof html2canvas === 'undefined') return;
    const canvas = await html2canvas(zone, { scale: 2, backgroundColor: '#ffffff' });
    const a = document.createElement('a');
    a.download = `Schedule_${getUnscopedWeekKey(currentWeekKey).replace(/ /g, '_')}.jpg`;
    a.href = canvas.toDataURL("image/jpeg", 0.9);
    a.click();
}

async function shareWhatsApp() {
    const cleanWeek = getUnscopedWeekKey(currentWeekKey);
    let summaryText = `*Hybrid Work Schedule (${cleanWeek})*\n\n`;
    const list = STAFF.length ? STAFF : ALL_STAFF;
    list.forEach(s => {
        const officeDays = DAYS.filter(d => currentData[s.name] && currentData[s.name][d] === 'Office');
        summaryText += `• *${s.name}*: ${officeDays.length ? officeDays.join(', ') : 'Remote'}\n`;
    });

    const zone = document.getElementById('capture-zone');
    if (zone && typeof html2canvas !== 'undefined') {
        const canvas = await html2canvas(zone, { scale: 2, backgroundColor: '#ffffff' });
        canvas.toBlob(async blob => {
            const file = new File([blob], `Schedule_${cleanWeek.replace(/ /g, '_')}.jpg`, { type: 'image/jpeg' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: 'Hybrid Schedule',
                        text: summaryText
                    });
                    return;
                } catch(e) {}
            }
            // Desktop fallback: Download image and open WhatsApp Web with text summary
            downloadImage();
            const waUrl = `https://web.whatsapp.com/send?text=${encodeURIComponent(summaryText)}`;
            window.open(waUrl, '_blank');
        }, 'image/jpeg', 0.9);
    } else {
        const waUrl = `https://wa.me/?text=${encodeURIComponent(summaryText)}`;
        window.open(waUrl, '_blank');
    }
}

function shareGmail() {
    currentData = ensureScheduleData(currentData);
    const cleanWeek = getUnscopedWeekKey(currentWeekKey);
    const subject = encodeURIComponent(`Hybrid Work Schedule: ${cleanWeek}`);
    let body = `Hello Team,\n\nHere is the hybrid work schedule for ${cleanWeek}:\n\n`;
    const list = STAFF.length ? STAFF : ALL_STAFF;
    list.forEach(s => {
        const officeDays = DAYS.filter(d => currentData[s.name] && currentData[s.name][d] === 'Office');
        body += `${s.name}: ${officeDays.length ? officeDays.join(', ') : 'Remote'}\n`;
    });
    body += `\nPlease check in at your office location when on-site.\n\nThank you.`;

    downloadImage();

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${encodeURIComponent(body)}`;
    const popup = window.open(gmailUrl, '_blank');
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        // Popup blocked fallback
        window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(body)}`;
    }
}

/* ============================================================
   INITIALIZATION
   ============================================================ */

window.onload = async () => {
    if (typeof initTheme === 'function') initTheme();
    if (typeof initRefreshButton === 'function') initRefreshButton();
    await initTenantHybridBranding();

    const adminControls = document.getElementById('admin-controls');
    if (adminControls && IS_ADMIN) {
        adminControls.style.display = 'flex';
        document.body.classList.add('admin-mode');
    }

    await loadDynamicStaff();
    await loadHistory(true);
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
};