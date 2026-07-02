/** @typedef {GoogleAppsScript} */

// Configuration defaults - overridable via Script Properties
const DEFAULT_CONFIG = {
    OFFICE_LAT: 6.4518631,
    OFFICE_LON: 3.5277863,
    RADIUS_METERS: 200,
    TIMEZONE: 'GMT+1'
};

const HYBRID_SCHEDULE_SHEET_ID = '1Mj-Pds8Kc4Rm_yh_EUafo3T-FEL7wurUco-u9l38lNk';

/**
 * Entry point for GET requests (JSONP fallback path).
 */
function doGet(e) {
  const result = routeRequest(e.parameter);
  const callback = e.parameter.callback || 'callback';
  return ContentService.createTextOutput(callback + '(' + JSON.stringify({ result }) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/**
 * Entry point for POST requests (preferred path).
 */
function doPost(e) {
  let params = {};
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, allowed: false, message: 'Malformed request body.' });
  }
  const csrfToken = params.csrfToken;
  if (!csrfToken || !isValidCsrfToken(csrfToken)) {
    return jsonOutput({ ok: false, message: 'Invalid or missing CSRF token.' });
  }
  const result = routeRequest(params);
  return jsonOutput(result);
}

function isValidCsrfToken(token) {
  if (!token || typeof token !== 'string') return false;
  return /^[a-f0-9]{64}$/i.test(token);
}

function jsonOutput(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    officeLat: parseFloat(props.getProperty('OFFICE_LAT') || DEFAULT_CONFIG.OFFICE_LAT),
    officeLon: parseFloat(props.getProperty('OFFICE_LON') || DEFAULT_CONFIG.OFFICE_LON),
    radiusMeters: parseInt(props.getProperty('RADIUS_METERS') || DEFAULT_CONFIG.RADIUS_METERS, 10),
    timezone: props.getProperty('TIMEZONE') || DEFAULT_CONFIG.TIMEZONE
  };
}

function routeRequest(params) {
  const mode = params.mode || 'attendance';
  switch (mode) {
    case 'admin-login': return adminLogin(params.username, params.passwordHash);
    case 'admin-change-password': return adminChangePassword(params.username, params.currentPasswordHash, params.newPasswordHash);
    case 'admin-set-recovery-email': return adminSetRecoveryEmail(params.username, params.currentPasswordHash, params.email);
    case 'admin-forgot-password-request': return adminForgotPasswordRequest(params.username);
    case 'admin-forgot-password-confirm': return adminForgotPasswordConfirm(params.username, params.code, params.newPasswordHash);
    case 'list-staff': return listStaff();
    case 'add-staff': return addStaff(params.name);
    case 'remove-staff': return removeStaff(params.name);
    case 'reset-staff-lock': return resetStaffLock(params.name);
    case 'get-config': return { ok: true, config: getConfig() };
    case 'update-config': return updateConfig(params);
    case 'list-logs': return listLogs({ name: params.name, fromDate: params.fromDate, toDate: params.toDate, limit: params.limit, weekStart: params.weekStart });
    case 'log-analytics': return logAnalyticsEvent(params.eventType, params.details, params.deviceId);
    case 'list-analytics': return listAnalyticsEvents(params.limit);
    case 'get-hybrid-schedule': return getHybridSchedule(params.weekStart);
    case 'verify-owner': return verifyOwner({ name: params.name, deviceId: params.deviceId });
    case 'register-owner': return registerOwner({ name: params.name, deviceId: params.deviceId });
    case 'reassign-owner': return reassignOwner({ name: params.name, deviceId: params.deviceId, resetCodeHash: params.resetCodeHash });
    default:
      return processAttendance({ name: params.name, action: params.action, lat: parseFloat(params.lat), lon: parseFloat(params.lon), deviceId: params.deviceId });
  }
}

/* ============================================================
   ADMIN AUTH
   ============================================================ */

const DEVELOPER_USERNAME = 'kaycee-dev';

function getAdminAccounts() {
  const raw = PropertiesService.getScriptProperties().getProperty('adminAccounts');
  return raw ? JSON.parse(raw) : {};
}

function saveAdminAccounts(accounts) {
  PropertiesService.getScriptProperties().setProperty('adminAccounts', JSON.stringify(accounts));
}

function adminLogin(username, passwordHash) {
  if (!username || !passwordHash) return { ok: false, message: 'Username and password are required.' };
  const cleanUsername = username.trim().toLowerCase();
  const devHash = PropertiesService.getScriptProperties().getProperty('developerPasswordHash');
  if (cleanUsername === DEVELOPER_USERNAME.toLowerCase() && devHash) {
    if (passwordHash === devHash) return { ok: true, message: 'Developer access granted.', role: 'developer' };
    return { ok: false, message: 'Invalid admin credentials.' };
  }
  const accounts = getAdminAccounts();
  if (Object.keys(accounts).length === 0) {
    accounts[cleanUsername] = { passwordHash, email: '', role: 'admin' };
    saveAdminAccounts(accounts);
    return { ok: true, message: 'Initial admin account created.', role: 'admin' };
  }
  const account = accounts[cleanUsername];
  if (account && passwordHash === account.passwordHash) return { ok: true, message: 'Admin access granted.', role: account.role || 'admin' };
  return { ok: false, message: 'Invalid admin credentials.' };
}

function adminChangePassword(username, currentPasswordHash, newPasswordHash) {
  if (!username || !currentPasswordHash || !newPasswordHash) return { ok: false, message: 'Current password verification is required.' };
  const cleanUsername = username.trim().toLowerCase();
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) return { ok: false, message: 'Account not found.' };
  if (currentPasswordHash !== account.passwordHash) return { ok: false, message: 'Current password is incorrect.' };
  account.passwordHash = newPasswordHash;
  saveAdminAccounts(accounts);
  return { ok: true, message: 'Password updated.' };
}

function adminSetRecoveryEmail(username, currentPasswordHash, email) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) return { ok: false, message: 'Account not found.' };
  if (currentPasswordHash !== account.passwordHash) return { ok: false, message: 'Current password is incorrect.' };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Enter a valid email address.' };
  account.email = email.trim();
  saveAdminAccounts(accounts);
  return { ok: true, message: 'Recovery email saved.' };
}

function adminForgotPasswordRequest(username) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  const genericMessage = 'If that account exists and has a recovery email set, a code has been sent.';
  if (!account || !account.email) return { ok: true, message: genericMessage };
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 15 * 60 * 1000;
  PropertiesService.getScriptProperties().setProperty('resetCode_' + cleanUsername, JSON.stringify({ code, expiresAt }));
  try {
    MailApp.sendEmail({ to: account.email, subject: 'Lifecard Attendance - Admin Password Reset Code', body: 'Your password reset code is: ' + code + '\n\nThis code expires in 15 minutes.' });
  } catch (err) {
    return { ok: false, message: 'Could not send recovery email.' };
  }
  return { ok: true, message: genericMessage };
}

function adminForgotPasswordConfirm(username, code, newPasswordHash) {
  const cleanUsername = (username || '').trim().toLowerCase();
  if (!cleanUsername || !code || !newPasswordHash) return { ok: false, message: 'Missing required fields.' };
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('resetCode_' + cleanUsername);
  if (!stored) return { ok: false, message: 'No reset code was requested, or it already expired.' };
  const { code: storedCode, expiresAt } = JSON.parse(stored);
  if (Date.now() > expiresAt) { props.deleteProperty('resetCode_' + cleanUsername); return { ok: false, message: 'This code has expired.' }; }
  if (code.trim() !== storedCode) return { ok: false, message: 'Incorrect code.' };
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) return { ok: false, message: 'Account not found.' };
  account.passwordHash = newPasswordHash;
  saveAdminAccounts(accounts);
  props.deleteProperty('resetCode_' + cleanUsername);
  return { ok: true, message: 'Password reset. You can now log in.' };
}

function setDeveloperPasswordOnce() {
  const DEV_PASSWORD_PLAINTEXT = 'Neon8888*#.';
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, DEV_PASSWORD_PLAINTEXT).map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  PropertiesService.getScriptProperties().setProperty('developerPasswordHash', hash);
  Logger.log('Developer password hash stored for username: ' + DEVELOPER_USERNAME);
}

function addAdminAccountOnce() {
  const NEW_USERNAME = 'admin';
  const NEW_PASSWORD_PLAINTEXT = 'Lifecard123';
  const NEW_EMAIL = 'KennethCOmeh@gmail.com';
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, NEW_PASSWORD_PLAINTEXT).map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  const accounts = getAdminAccounts();
  accounts[NEW_USERNAME.toLowerCase()] = { passwordHash: hash, email: NEW_EMAIL, role: 'admin' };
  saveAdminAccounts(accounts);
  Logger.log('Admin account created for: ' + NEW_USERNAME);
}

/* ============================================================
   STAFF MANAGEMENT
   ============================================================ */

function listStaff() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const staff = rows.filter(r => r[0] && r[0].toString().trim()).map(r => ({ name: r[0].toString().trim(), deviceId: r[1] ? r[1].toString().trim() : '' }));
  return { ok: true, staff: staff };
}

/**
 * Fast logs query with CacheService and bottom-up reading.
 * Supports weekStart (Monday date) for weekly pagination.
 * Caches results for 30 seconds for repeat calls.
 */
function listLogs(filters) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'logs_' + (filters.name || 'all') + '_' + (filters.weekStart || (filters.fromDate || 'none') + '_' + (filters.toDate || 'none')) + '_' + (filters.limit || '100');
  const cached = cache.get(cacheKey);
  if (cached) return { ok: true, logs: JSON.parse(cached) };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs');
  if (!logsSheet || logsSheet.getLastRow() < 2) return { ok: true, logs: [] };

  const config = getConfig();
  const lastRow = logsSheet.getLastRow();
  // Read last 500 rows from bottom (covers ~2 months)
  const rowsToRead = Math.min(lastRow - 1, 500);
  const startRow = lastRow - rowsToRead + 1;
  const rows = logsSheet.getRange(startRow, 1, rowsToRead, 6).getValues();

  const nameFilter = (filters.name || '').toString().trim().toLowerCase();
  const limit = filters.limit ? parseInt(filters.limit, 10) : 100;

  // Parse weekStart or date range
  let fromDate = null, toDate = null;
  if (filters.weekStart) {
    const monday = parseDdMmYyyy(filters.weekStart);
    if (monday) {
      fromDate = monday;
      toDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4); // Friday
    }
  } else {
    fromDate = filters.fromDate ? parseDdMmYyyy(filters.fromDate) : null;
    toDate = filters.toDate ? parseDdMmYyyy(filters.toDate) : null;
  }

  var logs = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row[1]) continue;
    
    // Handle date: could be Date object, string "dd/MM/yyyy", or empty
    var dateStr = '';
    if (row[0] instanceof Date) {
      // Do NOT use Utilities.formatDate here — it applies a timezone offset
      // on top of how Sheets stores Date objects internally (as UTC), which
      // produces the December 30 1899 artifact on many rows. Use JS date
      // methods instead, which read the local wall-clock values directly.
      var d = row[0];
      dateStr = String(d.getDate()).padStart(2, '0') + '/' +
                String(d.getMonth() + 1).padStart(2, '0') + '/' +
                d.getFullYear();
    } else {
      dateStr = row[0].toString().trim();
    }
    
    if (!dateStr) continue;
    
    if (nameFilter && row[1].toString().trim().toLowerCase() !== nameFilter) continue;
    if (fromDate || toDate) {
      var entryDate = parseDdMmYyyy(dateStr);
      if (!entryDate) continue;
      if (fromDate && entryDate < fromDate) continue;
      if (toDate && entryDate > toDate) continue;
    }
    logs.push({
      date: dateStr,
      name: row[1].toString().trim(),
      action: row[2] ? row[2].toString().trim() : '',
      time: row[3] ? row[3].toString().trim() : '',
      status: row[4] ? row[4].toString().trim() : '',
      distance: row[5] !== undefined && row[5] !== '' ? row[5].toString() : ''
    });
  }
  logs.reverse();
  if (limit > 0) logs = logs.slice(0, limit);
  cache.put(cacheKey, JSON.stringify(logs), 30);
  return { ok: true, logs: logs };
}

function parseDdMmYyyy(str) {
  if (!str) return null;
  const parts = str.toString().split('/');
  if (parts.length !== 3) return null;
  const dd = parseInt(parts[0], 10), mm = parseInt(parts[1], 10), yyyy = parseInt(parts[2], 10);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd);
}

function addStaff(name) {
  const cleanName = (name || '').toString().trim();
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const existing = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 1).getValues().flat();
  if (existing.some(i => i.toString().trim().toLowerCase() === cleanName.toLowerCase())) return { ok: false, message: 'Staff already exists.' };
  staffSheet.appendRow([cleanName, '']);
  return { ok: true, message: 'Staff added.', staff: listStaff().staff };
}

function removeStaff(name) {
  const cleanName = (name || '').toString().trim();
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const values = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
      staffSheet.deleteRow(i + 2);
      return { ok: true, message: 'Staff removed.', staff: listStaff().staff };
    }
  }
  return { ok: false, message: 'Staff not found.' };
}

function resetStaffLock(name) {
  const cleanName = (name || '').toString().trim();
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const values = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
      staffSheet.getRange(i + 2, 2).setValue('');
      return { ok: true, message: 'Device lock cleared.', staff: listStaff().staff };
    }
  }
  return { ok: false, message: 'Staff not found.' };
}

/* ============================================================
   DEVICE OWNERSHIP
   ============================================================ */

function verifyOwner(payload) {
  const staff = findStaffRecord(payload.name);
  if (!staff) return { allowed: false, message: 'Staff not found.' };
  const storedDeviceId = staff.deviceId || '';
  if (!storedDeviceId) return { allowed: true, message: 'No device lock yet. Registration allowed.' };
  if (storedDeviceId === payload.deviceId) return { allowed: true, message: 'Device verified.' };
  return { allowed: false, message: 'This device is locked to another staff account.' };
}

function registerOwner(payload) {
  const staff = findStaffRecord(payload.name);
  if (!staff) return { allowed: false, message: 'Staff not found.' };
  const storedDeviceId = staff.deviceId || '';
  if (!storedDeviceId) { saveStaffDeviceId(payload.name, payload.deviceId); return { allowed: true, message: 'Device registered.' }; }
  if (storedDeviceId === payload.deviceId) return { allowed: true, message: 'Device already registered.' };
  return { allowed: false, message: 'This device is locked to another staff account.' };
}

function reassignOwner(payload) {
  const props = PropertiesService.getScriptProperties();
  const storedResetHash = props.getProperty('adminResetCodeHash');
  if (!storedResetHash) return { allowed: false, message: 'No reset code has been configured by the admin yet.' };
  if (payload.resetCodeHash !== storedResetHash) return { allowed: false, message: 'Invalid reset code.' };
  saveStaffDeviceId(payload.name, payload.deviceId);
  return { allowed: true, message: 'Device reassigned.' };
}

/* ============================================================
   HYBRID SCHEDULE INTEGRATION
   ============================================================ */

function getHybridSchedule(weekStart) {
  if (!weekStart) return { ok: true, schedule: {} };
  try {
    const monday = parseDdMmYyyy(weekStart);
    if (!monday) return { ok: true, schedule: {} };
    const scheduleSS = SpreadsheetApp.openById(HYBRID_SCHEDULE_SHEET_ID);
    const sheet = scheduleSS.getSheets()[0];
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: true, schedule: {} };

    const schedule = {};
    const friday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4);
    const weekDates = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((dayName, index) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + index);
      return { dayName, date: Utilities.formatDate(d, 'GMT+1', 'dd/MM/yyyy') };
    });

    // The scheduler sheet may store a human-readable week label in row 1,
    // a timestamp in row 2, and a JSON blob in row 3 (first cell), or
    // it may store the JSON in a different cell. Be permissive: search
    // the sheet for a JSON blob near the matching week label.
    const config = getConfig();

    // Build human-friendly week label like "June 29 - July 3, 2026"
    function formatWeekLabel(mondayDate, fridayDate) {
      const tz = config.timezone || 'GMT+1';
      const m1 = Utilities.formatDate(mondayDate, tz, 'MMMM d');
      const m2 = Utilities.formatDate(fridayDate, tz, 'MMMM d');
      const y1 = Utilities.formatDate(mondayDate, tz, 'yyyy');
      // If years differ, include both years; otherwise include once
      if (Utilities.formatDate(mondayDate, tz, 'yyyy') !== Utilities.formatDate(fridayDate, tz, 'yyyy')) {
        return `${m1}, ${y1} - ${m2}, ${Utilities.formatDate(fridayDate, tz, 'yyyy')}`;
      }
      return `${m1} - ${m2}, ${y1}`;
    }

    const weekLabelHuman = formatWeekLabel(monday, friday);

    // Try to find a row whose first cell matches the week label exactly.
    let foundRow = -1;
    for (let r = 0; r < data.length; r++) {
      const cell = data[r][0] ? String(data[r][0]).trim() : '';
      if (!cell) continue;
      if (cell === weekLabelHuman) { foundRow = r; break; }
      // Also accept the plain monday dd/MM/yyyy representation
      if (cell === Utilities.formatDate(monday, 'GMT+1', 'dd/MM/yyyy')) { foundRow = r; break; }
    }

    // If we found the header row, look in the next couple rows for JSON
    if (foundRow >= 0) {
      const candidateCells = [];
      // look at the same column in the next 1-3 rows and also the row itself columns
      for (let c = 0; c < Math.min(6, data[foundRow].length); c++) {
        if (data[foundRow][c]) candidateCells.push(String(data[foundRow][c]));
      }
      for (let rr = foundRow + 1; rr <= Math.min(foundRow + 3, data.length - 1); rr++) {
        for (let c = 0; c < Math.min(6, data[rr].length); c++) {
          if (data[rr][c]) candidateCells.push(String(data[rr][c]));
        }
      }

      for (const cellStr of candidateCells) {
        const trimmed = String(cellStr).trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            const jsonSchedule = JSON.parse(trimmed);
            Object.entries(jsonSchedule).forEach(([rawName, weekMap]) => {
              const staffName = String(rawName || '').trim();
              if (!staffName || typeof weekMap !== 'object' || Array.isArray(weekMap)) return;
              schedule[staffName] = [];
              weekDates.forEach(({ dayName, date }) => {
                const rawLocation = String(weekMap[dayName] || weekMap[dayName.toLowerCase()] || '').trim().toLowerCase();
                if (!rawLocation) return;
                schedule[staffName].push({
                  date,
                  location: (rawLocation === 'office' || rawLocation === 'on-site' || rawLocation === 'present') ? 'office' : 'home'
                });
              });
            });
            return { ok: true, schedule };
          } catch (jsonErr) {
            // continue searching
          }
        }
      }
    }

    // Fallback: scan the whole sheet for any JSON blob and attempt to use it
    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < Math.min(10, data[r].length); c++) {
        const cellVal = data[r][c];
        if (!cellVal) continue;
        const s = String(cellVal).trim();
        if (s.startsWith('{') || s.startsWith('[')) {
          try {
            const jsonSchedule = JSON.parse(s);
            Object.entries(jsonSchedule).forEach(([rawName, weekMap]) => {
              const staffName = String(rawName || '').trim();
              if (!staffName || typeof weekMap !== 'object' || Array.isArray(weekMap)) return;
              schedule[staffName] = [];
              weekDates.forEach(({ dayName, date }) => {
                const rawLocation = String(weekMap[dayName] || weekMap[dayName.toLowerCase()] || '').trim().toLowerCase();
                if (!rawLocation) return;
                schedule[staffName].push({
                  date,
                  location: (rawLocation === 'office' || rawLocation === 'on-site' || rawLocation === 'present') ? 'office' : 'home'
                });
              });
            });
            return { ok: true, schedule };
          } catch (e) {
            // ignore and continue
          }
        }
      }
    }

    const headers = data[0];
    for (let col = 1; col < headers.length; col++) {
      let headerDate = null;
      if (headers[col] instanceof Date) headerDate = Utilities.formatDate(headers[col], 'GMT+1', 'dd/MM/yyyy');
      else if (typeof headers[col] === 'string') headerDate = headers[col].trim();
      if (!headerDate) continue;

      const entryDate = parseDdMmYyyy(headerDate);
      if (!entryDate) continue;
      if (entryDate < monday || entryDate > friday) continue;

      for (let row = 1; row < data.length; row++) {
        const staffName = data[row][0] ? data[row][0].toString().trim() : '';
        if (!staffName) continue;
        const location = data[row][col] ? data[row][col].toString().trim().toLowerCase() : '';
        if (!location) continue;
        if (!schedule[staffName]) schedule[staffName] = [];
        schedule[staffName].push({
          date: headerDate,
          location: (location === 'office' || location === 'on-site' || location === 'present') ? 'office' : 'home'
        });
      }
    }
    return { ok: true, schedule };
  } catch (err) {
    console.error('Could not fetch hybrid schedule: ' + err.message);
    return { ok: true, schedule: {} };
  }
}

/* ============================================================
   ATTENDANCE
   ============================================================ */

function processAttendance(payload) {
  if (!payload.name || !payload.action) return 'BLOCK|Missing required fields.';
  if (isNaN(payload.lat) || isNaN(payload.lon)) return 'BLOCK|Location data is missing or invalid.';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs') || ss.insertSheet('Logs');
  const staffSheet = getOrCreateStaffSheet(ss);
  const config = getConfig();

  const now = new Date();
  const todayStr = Utilities.formatDate(now, config.timezone, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, config.timezone, 'hh:mm a');
  const hour = now.getHours();

  const staffData = staffSheet.getDataRange().getValues();
  let staffExists = false, staffRow = -1;
  const incomingParts = (payload.deviceId || '').split('-');
  const incomingHW = incomingParts[1] || '', incomingSalt = incomingParts[2] || '';

  for (let i = 1; i < staffData.length; i++) {
    const regName = staffData[i][0].toString().trim();
    if (!regName) continue;
    const regFullID = staffData[i][1] ? staffData[i][1].toString().trim() : '';
    const regParts = regFullID.split('-');
    const regHW = regParts[1] || '', regSalt = regParts[2] || '';
    const isCurrentStaff = regName.toLowerCase() === payload.name.trim().toLowerCase();
    if (isCurrentStaff) staffExists = true;

    if (regFullID !== '') {
      if (isCurrentStaff) {
        staffRow = i + 1;
        if (incomingHW !== regHW && incomingSalt !== regSalt) return 'BLOCK|Device mismatch. This account is locked to a different phone.';
        if (regFullID !== payload.deviceId) staffSheet.getRange(staffRow, 2).setValue(payload.deviceId);
      } else if (incomingHW === regHW || incomingSalt === regSalt) {
        return 'BLOCK|This device is already registered to ' + regName + '. Device sharing is not allowed.';
      }
    } else if (isCurrentStaff) {
      staffRow = i + 1;
      staffSheet.getRange(staffRow, 2).setValue(payload.deviceId);
    }
  }

  if (!staffExists) return 'BLOCK|Staff member not recognized. Contact your administrator.';

  const dist = getDistance(config.officeLat, config.officeLon, payload.lat, payload.lon);
  if (dist > config.radiusMeters) {
    logDistanceAlert(payload.name, payload.action, dist, payload.lat, payload.lon);
    return 'BLOCK|Denied. You are too far from the office (' + dist.toFixed(0) + 'm).|' + dist.toFixed(0);
  }

  // Use bottom-up approach for logs check (faster)
  const logsLastRow = logsSheet.getLastRow();
  const logsRowsToCheck = Math.min(logsLastRow - 1, 200);
  const logsStartRow = Math.max(2, logsLastRow - logsRowsToCheck + 1);
  const logs = logsRowsToCheck > 0 ? logsSheet.getRange(logsStartRow, 1, logsRowsToCheck, 6).getValues() : [];

  let hasSignedInToday = false, hasSignedOutToday = false;
  let lastAction = '', lastDate = '';

  for (let j = logs.length - 1; j >= 0; j--) {
    if (!logs[j][1]) continue;
    if (logs[j][1].toString().trim().toLowerCase() === payload.name.trim().toLowerCase()) {
      const logDate = logs[j][0] instanceof Date
        ? (function(d) { return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear(); })(logs[j][0])
        : logs[j][0].toString().trim();
      if (lastAction === '') { lastAction = logs[j][2]; lastDate = logDate; }
      if (logDate === todayStr) {
        if (logs[j][2] === 'IN') hasSignedInToday = true;
        if (logs[j][2] === 'OUT') hasSignedOutToday = true;
      }
    }
  }

  if (payload.action === 'IN' && hasSignedInToday) return 'BLOCK|You have already signed in for today.';
  if (payload.action === 'OUT' && hasSignedOutToday) return 'BLOCK|Attendance is already closed for today.';

  let forgotMsg = '';
  if (payload.action === 'IN' && lastAction === 'IN' && lastDate !== todayStr) {
    // Store date as string to avoid timezone shifts
    logsSheet.appendRow([lastDate, payload.name, 'OUT', 'Missed', 'Missed', '']);
    forgotMsg = '. Note: You forgot to sign out on ' + lastDate;
  }

  let responseStatus = 'NORMAL';
  let logStatus = 'On Time';
  let greeting = '';
  if (payload.action === 'IN') {
    if (hour < 9) {
      responseStatus = 'WELCOME';
      greeting = 'Welcome! Have a productive day' + forgotMsg;
      logStatus = 'On Time';
    } else {
      responseStatus = 'LATE';
      greeting = 'You are late' + forgotMsg;
      logStatus = 'Late';
    }
  } else {
    if (!hasSignedInToday) return 'BLOCK|You cannot sign out without signing in first.';
    if (hour < 17) {
      responseStatus = 'LATE';
      greeting = 'Early sign-out recorded. It is not yet 5:00 PM.';
      logStatus = 'Early Out';
    } else {
      responseStatus = 'NORMAL';
      greeting = 'Safe trip, ' + payload.name + '! See you tomorrow.';
      logStatus = 'On Time';
    }
  }

  // Store date as string to avoid timezone shifts when reading back
  logsSheet.appendRow([todayStr, payload.name, payload.action, timeStr, logStatus, dist.toFixed(0)]);
  return responseStatus + '|' + greeting + '|' + dist.toFixed(0);
}

/* ============================================================
   CONFIGURATION MANAGEMENT
   ============================================================ */

function updateConfig(params) {
  const allowedKeys = ['OFFICE_LAT', 'OFFICE_LON', 'RADIUS_METERS'];
  const key = params.key, value = params.value;
  if (!key || !allowedKeys.includes(key)) return { ok: false, message: 'Invalid configuration key. Allowed keys: ' + allowedKeys.join(', ') };
  if (key === 'OFFICE_LAT' || key === 'OFFICE_LON') {
    const num = parseFloat(value);
    if (isNaN(num) || num < -90 || num > 90) return { ok: false, message: 'Invalid coordinate value.' };
  } else if (key === 'RADIUS_METERS') {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 10 || num > 5000) return { ok: false, message: 'Invalid radius. Must be 10-5000.' };
  }
  PropertiesService.getScriptProperties().setProperty(key, value.toString());
  return { ok: true, message: 'Configuration updated.', config: getConfig() };
}

/* ============================================================
   HELPERS
   ============================================================ */

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getOrCreateStaffSheet(ss) {
  let staffSheet = ss.getSheetByName('Staff');
  if (!staffSheet) { staffSheet = ss.insertSheet('Staff'); staffSheet.appendRow(['Name', 'Device ID']); }
  return staffSheet;
}

function getOrCreateDistanceAlertsSheet(ss) {
  let alertsSheet = ss.getSheetByName('Distance Alerts');
  if (!alertsSheet) { alertsSheet = ss.insertSheet('Distance Alerts'); alertsSheet.appendRow(['Date', 'Time', 'Name', 'Action', 'Distance(m)', 'Lat', 'Lon']); }
  return alertsSheet;
}

function logDistanceAlert(name, action, dist, lat, lon) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const alertsSheet = getOrCreateDistanceAlertsSheet(ss);
  const now = new Date();
  const config = getConfig();
  const todayStr = Utilities.formatDate(now, config.timezone, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, config.timezone, 'hh:mm a');
  alertsSheet.appendRow([todayStr, timeStr, name, action, dist.toFixed(0), lat, lon]);
}

function findStaffRecord(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const cleanName = (name || '').toString().trim().toLowerCase();
  const match = rows.find(r => r[0].toString().trim().toLowerCase() === cleanName);
  if (!match) return null;
  return { name: match[0].toString().trim(), deviceId: match[1] ? match[1].toString().trim() : '' };
}

function saveStaffDeviceId(name, deviceId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const cleanName = (name || '').toString().trim().toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0].toString().trim().toLowerCase() === cleanName) { staffSheet.getRange(i + 2, 2).setValue(deviceId || ''); return; }
  }
  staffSheet.appendRow([name, deviceId || '']);
}

function setDeviceResetCodeOnce() {
  const RESET_CODE_PLAINTEXT = 'lifecard-admin-reset';
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, RESET_CODE_PLAINTEXT)
    .map(function(b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); })
    .join('');
  PropertiesService.getScriptProperties().setProperty('adminResetCodeHash', hash);
  Logger.log('Reset code hash stored.');
}

/**
 * ONE-TIME MIGRATION: Run this once from the Apps Script editor to
 * convert any legacy Date-object rows in the Logs sheet to plain
 * dd/MM/yyyy strings. This permanently fixes the 1899 date artifact
 * caused by old versions of the script that wrote Date objects instead
 * of strings. Safe to run multiple times - already-string rows are
 * left unchanged. Check the execution log for a summary when done.
 */
function migrateLogsDateStrings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs');
  if (!logsSheet) { Logger.log('No Logs sheet found.'); return; }
  const lastRow = logsSheet.getLastRow();
  if (lastRow < 2) { Logger.log('Logs sheet is empty.'); return; }
  const range = logsSheet.getRange(2, 1, lastRow - 1, 1);
  const values = range.getValues();
  let fixed = 0, skipped = 0;
  for (var i = 0; i < values.length; i++) {
    var cell = values[i][0];
    if (cell instanceof Date) {
      // Use JS date methods - NOT Utilities.formatDate - to avoid the
      // timezone double-shift that causes the 1899 artifact.
      var d = cell;
      var dateStr = String(d.getDate()).padStart(2, '0') + '/' +
                    String(d.getMonth() + 1).padStart(2, '0') + '/' +
                    d.getFullYear();
      // Sanity check: reject anything that resolved to 1899
      if (d.getFullYear() < 1950) {
        Logger.log('Row ' + (i + 2) + ': Skipping suspicious date ' + d.toString());
        skipped++;
        continue;
      }
      logsSheet.getRange(i + 2, 1).setValue(dateStr);
      fixed++;
    }
  }
  Logger.log('Migration complete. Fixed: ' + fixed + ' rows. Skipped (suspicious): ' + skipped + ' rows.');
}

/* ============================================================
   CLIENT ANALYTICS
   Staff device errors/events are reported here so the admin can
   see them in the Analytics tab rather than being invisible.
   Stored in a lightweight rolling JSON array in Script Properties
   (max 100 events, older ones drop off). Not a full logging
   infrastructure — just enough to surface errors from the field.
   ============================================================ */

function logAnalyticsEvent(eventType, details, deviceId) {
  if (!eventType) return { ok: false };
  const props = PropertiesService.getScriptProperties();
  let events = [];
  try { events = JSON.parse(props.getProperty('analyticsEvents') || '[]'); } catch (e) { events = []; }
  const config = getConfig();
  const now = new Date();
  events.unshift({
    type: eventType,
    details: details || '',
    deviceId: deviceId || '',
    time: Utilities.formatDate(now, config.timezone, 'dd/MM/yyyy HH:mm:ss')
  });
  if (events.length > 100) events = events.slice(0, 100);
  try {
    props.setProperty('analyticsEvents', JSON.stringify(events));
  } catch (e) {
    // Script Properties has a 9KB-per-property limit; if it overflows, trim aggressively
    events = events.slice(0, 20);
    props.setProperty('analyticsEvents', JSON.stringify(events));
  }
  return { ok: true };
}

function listAnalyticsEvents(limit) {
  const props = PropertiesService.getScriptProperties();
  let events = [];
  try { events = JSON.parse(props.getProperty('analyticsEvents') || '[]'); } catch (e) { events = []; }
  const cap = limit ? parseInt(limit, 10) : 50;
  return { ok: true, events: events.slice(0, cap) };
}