const supabaseUrl = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || 'https://akhditjeiwjuzvubnacw.supabase.co';
const supabaseKey = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_KEY) || 'sb_publishable_9BkVRtmi-6UG15Va5xNHbw_R7J_hKhi';
const supabaseClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

const STORAGE_KEY = "lifecard-hybrid-schedule-backup";
const HISTORY_STORAGE_KEY = "lifecard-hybrid-schedule-history";

const urlParams = new URLSearchParams(window.location.search);
// Default to read-only viewer mode. Enable admin mode only with the secret key parameter.
const IS_ADMIN = urlParams.get('key') === 'admin';

const STAFF = [
    { name: "Julianah", dept: "Investment" },
    { name: "Blessingjoy", dept: "University" },
    { name: "Ikechukwu", dept: "Investment" },
    { name: "Ayomide", dept: "Investment" },
    { name: "Esther", dept: "University" },
    { name: "Paschaline", dept: "University" },
    { name: "Deborah", dept: "Investment" },
    { name: "Elizabeth", dept: "Investment" }
];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

let currentWeekKey = "";
let currentData = {};
let draggedItem = null;

function createDefaultScheduleData() {
    const data = {};
    STAFF.forEach(s => {
        data[s.name] = { Monday: "Office", Tuesday: "Home", Wednesday: "Home", Thursday: "Home", Friday: "Home" };
    });
    return data;
}

function ensureScheduleData(data) {
    const normalized = data && typeof data === 'object' ? data : {};
    const fallback = createDefaultScheduleData();

    STAFF.forEach(person => {
        if (!normalized[person.name] || typeof normalized[person.name] !== 'object') {
            normalized[person.name] = { ...fallback[person.name] };
        }
        DAYS.forEach(day => {
            if (!normalized[person.name][day]) {
                normalized[person.name][day] = fallback[person.name][day];
            }
        });
    });

    return normalized;
}

// Initialize
if (IS_ADMIN) {
    document.getElementById('admin-controls').style.display = 'flex';
    document.getElementById('main-body').classList.add('admin-mode');
}

function loadLocalBackup() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        if (parsed && parsed.weekKey && parsed.data) return parsed;
    } catch (e) {
        console.warn('Unable to read local backup:', e);
    }
    return null;
}

function saveLocalBackup(weekKey, data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ weekKey, data, timestamp: new Date().toISOString() }));
    } catch (e) {
        console.warn('Unable to save local backup:', e);
    }
}

function loadLocalHistory() {
    try {
        const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn('Unable to read local history:', e);
        return [];
    }
}

function saveLocalHistory(entry) {
    const history = loadLocalHistory();
    const merged = history.filter(item => item.weekKey !== entry.weekKey);
    merged.unshift(entry);
    const trimmed = merged.slice(0, 20);

    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn('Unable to save local history:', e);
    }
}

function mergeHistory(remoteHistory, localHistory) {
    const map = new Map();
    [...remoteHistory, ...localHistory].forEach(item => {
        if (!item || !item.weekKey || !item.data) return;
        const current = map.get(item.weekKey);
        const itemTime = new Date(item.timestamp || 0).getTime();
        if (!current || itemTime > new Date(current.timestamp || 0).getTime()) {
            map.set(item.weekKey, item);
        }
    });

    return Array.from(map.values()).sort((a, b) => {
        return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
    });
}

// --- 2. DATE LOGIC (Bulletproof Monday-Friday Range) ---
function getWeekDates(offsetWeeks = 0, baseDate = new Date()) {
    const date = new Date(baseDate);
    date.setHours(12, 0, 0, 0);

    const day = date.getDay();
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(date);
    monday.setDate(date.getDate() - diffToMonday + (offsetWeeks * 7));

    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    return { monday, friday };
}

function getWeekRange(offsetWeeks = 0) {
    const { monday, friday } = getWeekDates(offsetWeeks);

    // Always use one fully-qualified, unconditional format -- both month
    // names spelled out, year always included -- no matter whether the
    // week crosses a month or year boundary. This used to branch: a
    // same-month week produced "July 6 - 10, 2026", while a same-year
    // cross-month week produced "June 29 - July 3" with NO YEAR AT ALL.
    // That year-less case is genuinely ambiguous to match back against on
    // the admin backend (which week/year is it?), and was the actual cause
    // of month-crossover weeks not showing hybrid data on the dashboard. A
    // single, unconditional format has no ambiguity to begin with.
    const startText = monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const endText = friday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return `${startText} - ${endText}`;
}

function getDayNumbers(offsetWeeks = 0) {
    const { monday } = getWeekDates(offsetWeeks);
    return DAYS.map((_, i) => {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        return day.getDate();
    });
}

function generateNew() {
    currentWeekKey = getWeekRange(0);
    currentData = createDefaultScheduleData();

    const flexibleDays = ["Tuesday", "Wednesday", "Thursday", "Friday"];
    const occupancy = { Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 };

    // Shuffle staff list to ensure randomization
    const shuffledStaff = [...STAFF].sort(() => Math.random() - 0.5);

    shuffledStaff.forEach(person => {
        const sortedDays = [...flexibleDays].sort((a, b) => {
            if (occupancy[a] !== occupancy[b]) {
                return occupancy[a] - occupancy[b];
            }
            return Math.random() - 0.5;
        });

        const assignedDays = sortedDays.slice(0, 2);
        assignedDays.forEach(day => {
            currentData[person.name][day] = "Office";
            occupancy[day]++;
        });
    });

    renderTable();
    autoSync();
}

function renderTable() {
    currentData = ensureScheduleData(currentData);
    currentWeekKey = currentWeekKey || getWeekRange(0);
    document.getElementById('display-date-range').innerText = currentWeekKey;
    const dayNums = getDayNumbers();
    const thead = document.getElementById('table-head-days');
    thead.innerHTML = `<th class="name-cell">Staff Name</th>` +
        DAYS.map((d, i) => `<th>${d} ${dayNums[i]}</th>`).join("") +
        `<th class="counter-header" data-html2canvas-ignore>Home Days</th>`;

    const tbody = document.getElementById('schedule-body');
    tbody.innerHTML = "";

    STAFF.forEach(person => {
        const row = document.createElement('tr');
        row.innerHTML = `<td class="name-cell">${person.name}<span class="dept-label">${person.dept}</span></td>`;

        let homeCount = 0;
        DAYS.forEach(day => {
            const status = currentData[person.name][day];
            if (status === 'Home') homeCount++;

            const td = document.createElement('td');
            td.dataset.staff = person.name;
            td.dataset.day = day;

            const badge = document.createElement('div');
            badge.className = `badge ${status === 'Office' ? 'status-office' : 'status-home'}`;
            badge.innerText = status;

            if (IS_ADMIN) {
                badge.draggable = true;
                badge.addEventListener('dragstart', () => draggedItem = { staff: person.name, day: day });
                td.addEventListener('dragover', (e) => e.preventDefault());
                td.addEventListener('drop', () => {
                    if (draggedItem && draggedItem.staff === td.dataset.staff) {
                        const temp = currentData[person.name][td.dataset.day];
                        currentData[person.name][td.dataset.day] = currentData[person.name][draggedItem.day];
                        currentData[person.name][draggedItem.day] = temp;
                        renderTable();
                        autoSync();
                    }
                });
                badge.onclick = () => {
                    currentData[person.name][day] = (status === 'Office' ? 'Home' : 'Office');
                    renderTable();
                    autoSync();
                };
            }
            td.appendChild(badge);
            row.appendChild(td);
        });

        const countTd = document.createElement('td');
        countTd.className = "counter-cell";
        countTd.setAttribute('data-html2canvas-ignore', 'true');
        const countClass = (homeCount === 2) ? 'count-ok' : 'count-bad';
        countTd.innerHTML = `<span class="counter-val ${countClass}">${homeCount}</span><span class="counter-label">Home Days</span>`;
        row.appendChild(countTd);
        tbody.appendChild(row);
    });
    lucide.createIcons();
}

// --- 4. CLOUD & EXPORT ---

// Debounce + single-flight guards for cloud sync. Without these, clicking
// several badges quickly fired one overlapping fetch() per click; since
// network responses aren't guaranteed to arrive in the order the requests
// were sent, an EARLIER click's response could land AFTER a later click's,
// overwriting the sheet with stale data even though the UI showed "Synced"
// (that status just reflects whichever request finished last, not
// necessarily the one that captured your final edit).
let syncDebounceTimer = null;
let syncInFlight = false;
let syncQueued = false;

function autoSync() {
    // Local backup/history are cheap and safe to do on every single edit
    // immediately, regardless of cloud debounce timing.
    saveLocalBackup(currentWeekKey, currentData);
    saveLocalHistory({ weekKey: currentWeekKey, data: currentData, timestamp: new Date().toISOString() });

    if (!IS_ADMIN) return;

    const statusEl = document.getElementById('sync-status');
    statusEl.innerHTML = `<i data-lucide="refresh-cw" class="spin" size="12"></i> Saving to cloud...`;
    lucide.createIcons();

    // Coalesce a burst of rapid edits into a single outgoing request: reset
    // the timer on every call, so only the LAST edit in a fast sequence
    // actually triggers a network send, and it always sends whatever
    // currentData is at that moment (i.e. the latest state).
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(performCloudSync, 500);
}

async function performCloudSync() {
    if (syncInFlight) {
        syncQueued = true;
        return;
    }

    if (!supabaseClient) {
        const statusEl = document.getElementById('sync-status');
        if (statusEl) statusEl.innerHTML = `<i data-lucide="wifi-off" size="12"></i> Saved locally (offline)`;
        return;
    }

    syncInFlight = true;
    const statusEl = document.getElementById('sync-status');
    statusEl.innerHTML = `<i data-lucide="refresh-cw" size="12" class="spin"></i> Syncing...`;
    lucide.createIcons();

    const weekKeyToSend = currentWeekKey;
    const dataToSend = JSON.parse(JSON.stringify(currentData));

    try {
        const { error } = await supabaseClient
            .from('hybrid_schedules')
            .upsert({
                week_key: weekKeyToSend,
                schedule_data: dataToSend,
                timestamp: new Date().toISOString()
            }, { onConflict: 'week_key' });

        if (error) throw error;

        statusEl.innerHTML = `<i data-lucide="cloud-check" size="12"></i> Synced`;
        saveLocalBackup(weekKeyToSend, dataToSend);
        saveLocalHistory({ weekKey: weekKeyToSend, data: dataToSend, timestamp: new Date().toISOString() });
        await loadHistory(false);
    } catch (e) {
        console.error('autoSync failed:', e);
        statusEl.innerHTML = `<i data-lucide="wifi-off" size="12"></i> Saved locally (offline)`;
    }
    lucide.createIcons();

    syncInFlight = false;
    if (syncQueued) {
        syncQueued = false;
        performCloudSync();
    }
}

async function loadHistory(updateTable = true) {
    const container = document.getElementById('history-container');
    const localHistory = loadLocalHistory();
    const backup = loadLocalBackup();

    if (!supabaseClient) {
        displayLocalHistoryOnly(container, localHistory, backup, updateTable);
        lucide.createIcons();
        return;
    }

    try {
        const { data: dbData, error } = await supabaseClient
            .from('hybrid_schedules')
            .select('*')
            .order('timestamp', { ascending: false });

        if (error) throw error;

        const remoteHistory = (dbData || []).map(row => ({
            weekKey: row.week_key,
            data: row.schedule_data,
            timestamp: row.timestamp
        }));

        const history = mergeHistory(remoteHistory, localHistory);

        container.innerHTML = "";
        history.forEach(item => {
            const card = document.createElement('div');
            card.className = `history-card ${item.weekKey === currentWeekKey ? 'active' : ''}`;
            card.onclick = () => {
                currentWeekKey = item.weekKey;
                currentData = ensureScheduleData(item.data);
                renderTable();
            };
            card.innerHTML = `<i data-lucide="calendar"></i><div class="history-info">${item.weekKey}</div>`;
            container.appendChild(card);
        });

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
                // Viewer mode fallback: display the latest available schedule in history
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
    } catch (e) {
        console.warn('loadHistory from Supabase failed, falling back to local:', e);
        displayLocalHistoryOnly(container, localHistory, backup, updateTable);
    }

    lucide.createIcons();
}

function displayLocalHistoryOnly(container, localHistory, backup, updateTable) {
    const history = localHistory.length > 0 ? localHistory : backup ? [backup] : [];
    container.innerHTML = "";
    history.forEach(item => {
        const card = document.createElement('div');
        card.className = `history-card ${item.weekKey === currentWeekKey ? 'active' : ''}`;
        card.onclick = () => {
            currentWeekKey = item.weekKey;
            currentData = ensureScheduleData(item.data);
            renderTable();
        };
        card.innerHTML = `<i data-lucide="calendar"></i><div class="history-info">${item.weekKey}</div>`;
        container.appendChild(card);
    });

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
    lucide.createIcons();
}

async function downloadImage() {
    const zone = document.getElementById('capture-zone');
    const canvas = await html2canvas(zone, { scale: 2, backgroundColor: '#ffffff' });
    const a = document.createElement('a');
    a.download = `Schedule_${currentWeekKey.replace(/ /g, '_')}.jpg`;
    a.href = canvas.toDataURL("image/jpeg", 0.9);
    a.click();
}

async function shareWhatsApp() {
    const zone = document.getElementById('capture-zone');
    const canvas = await html2canvas(zone, { scale: 2, backgroundColor: '#ffffff' });
    canvas.toBlob(async blob => {
        const file = new File([blob], `Schedule.jpg`, { type: 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Lifecard Schedule', text: `Hybrid Schedule for ${currentWeekKey}` });
        } else { downloadImage(); }
    }, 'image/jpeg', 0.9);
}

function shareGmail() {
    currentData = ensureScheduleData(currentData);
    const subject = encodeURIComponent(`Hybrid Schedule: ${currentWeekKey}`);
    let body = `Hello Team,\n\nHere is the schedule for ${currentWeekKey}:\n\n`;
    STAFF.forEach(s => {
        const office = DAYS.filter(d => currentData[s.name][d] === 'Office');
        body += `${s.name}: ${office.join(", ")}\n`;
    });
    downloadImage();
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(urlParams.get('to') || '')}&su=${subject}&body=${encodeURIComponent(body)}`, '_blank');
}

window.onload = () => {
    loadHistory(true);
    lucide.createIcons();
};