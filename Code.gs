/**
 * Lifecard Staff Attendance Portal - Google Apps Script Backend (Code.gs)
 * Integrated with Security, Input Sanitization, Rate Limiting & Constant-Time Hashing Protocols
 */

// Configuration defaults - overridable via Script Properties
var DEFAULT_CONFIG = (typeof DEFAULT_CONFIG !== 'undefined') ? DEFAULT_CONFIG : {
    OFFICE_LAT: 6.4518631,
    OFFICE_LON: 3.5277863,
    RADIUS_METERS: 100,
    TIMEZONE: 'GMT+1',
    LATE_CUTOFF_MINUTES: 511 // 8:31 AM (511 minutes from midnight)
};

var HYBRID_SCHEDULE_SHEET_ID = (typeof HYBRID_SCHEDULE_SHEET_ID !== 'undefined') ? HYBRID_SCHEDULE_SHEET_ID : '';

function getScriptConfigProperty(key, fallback) {
  try {
    return PropertiesService.getScriptProperties().getProperty(key) || fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * Run this function ONCE in the Apps Script Editor to permanently save your Hybrid Schedule Sheet ID.
 */
function setHybridScheduleSheetId() {
  const sheetId = '1Mj-Pds8Kc4Rm_yh_EUafo3T-FEL7wurUco-u9l38lNk';
  PropertiesService.getScriptProperties().setProperty('HYBRID_SCHEDULE_SHEET_ID', sheetId);
  Logger.log('✅ HYBRID_SCHEDULE_SHEET_ID permanently saved: ' + sheetId);
}


/* ============================================================
   SECURITY & UTILITY HELPERS
   ============================================================ */

/**
 * Constant-time string comparison to prevent timing side-channel attacks on password hashes and tokens.
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Strips HTML tags, script tags, and trims whitespace.
 */
function sanitizeInput(input, maxLen = 100) {
  if (input === null || input === undefined) return '';
  let str = String(input).trim();
  str = str.replace(/<[^>]*>/g, ''); // strip HTML tags
  if (maxLen && str.length > maxLen) {
    str = str.substring(0, maxLen);
  }
  return str;
}

/**
 * Rate limiting helper using CacheService to prevent brute force attacks on sensitive endpoints.
 */
function checkRateLimit(key, maxAttempts = 5, lockTimeSeconds = 900) {
  const cache = CacheService.getScriptCache();
  const lockKey = 'lock_' + key;
  const countKey = 'count_' + key;

  if (cache.get(lockKey)) {
    return { allowed: false, message: 'Too many failed attempts. Account locked temporarily for 15 minutes.' };
  }

  const count = parseInt(cache.get(countKey) || '0', 10);
  if (count >= maxAttempts) {
    cache.put(lockKey, 'locked', lockTimeSeconds);
    cache.remove(countKey);
    return { allowed: false, message: 'Too many failed attempts. Account locked temporarily for 15 minutes.' };
  }

  return { allowed: true, currentCount: count, increment: () => {
    cache.put(countKey, String(count + 1), lockTimeSeconds);
  }, reset: () => {
    cache.remove(countKey);
    cache.remove(lockKey);
  }};
}

function isValidCsrfToken(token) {
  if (!token || typeof token !== 'string') return false;
  return /^[a-f0-9]{64}$/i.test(token);
}

function generateSecureToken() {
  const bytes = [];
  for (let i = 0; i < 32; i++) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  const timestamp = Date.now().toString();
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, timestamp + JSON.stringify(bytes))
    .map(function(b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); })
    .join('');
}

function verifyAdminAuth(username, adminToken, csrfToken) {
  const cleanUsername = sanitizeInput(username, 50).toLowerCase();
  if (!cleanUsername || !adminToken) return false;

  const devUsername = getScriptConfigProperty('DEVELOPER_USERNAME', 'Kaycee').toLowerCase();
  const devHash = PropertiesService.getScriptProperties().getProperty('developerPasswordHash');
  let isValidAdmin = false;

  if (cleanUsername === devUsername && devHash && constantTimeCompare(adminToken, devHash)) {
    isValidAdmin = true;
  } else {
    const accounts = getAdminAccounts();
    const account = accounts[cleanUsername];
    if (account && constantTimeCompare(adminToken, account.passwordHash)) {
      isValidAdmin = true;
    }
  }

  if (!isValidAdmin) return false;

  if (csrfToken) {
    const cachedCsrf = CacheService.getScriptCache().get('csrf_' + cleanUsername);
    if (cachedCsrf && !constantTimeCompare(csrfToken, cachedCsrf)) {
      return false;
    }
  }

  return true;
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
    timezone: props.getProperty('TIMEZONE') || DEFAULT_CONFIG.TIMEZONE,
    lateCutoffMinutes: parseInt(props.getProperty('LATE_CUTOFF_MINUTES') || DEFAULT_CONFIG.LATE_CUTOFF_MINUTES, 10)
  };
}

/* ============================================================
   ROUTING
   ============================================================ */

function doGet(e) {
  return jsonOutput({ ok: false, allowed: false, message: 'GET requests are disabled for security. Use POST via proxy.' });
}

function doPost(e) {
  let params = {};
  try {
    if (e && e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      params = e.parameter;
    }
  } catch (err) {
    if (e && e.parameter && Object.keys(e.parameter).length > 0) {
      params = e.parameter;
    } else {
      return jsonOutput({ ok: false, allowed: false, message: 'Malformed request body.' });
    }
  }

  const result = routeRequest(params);
  return jsonOutput(result);
}

function routeRequest(params) {
  const mode = sanitizeInput(params.mode || 'attendance', 50);

  const adminModes = [
    'admin-change-password',
    'admin-set-recovery-email',
    'add-staff',
    'remove-staff',
    'reset-staff-lock',
    'reset-all-locks',
    'get-sheet-url',
    'update-config'
  ];

  if (adminModes.includes(mode)) {
    if (!verifyAdminAuth(params.username, params.adminToken, params.csrfToken)) {
      return { ok: false, allowed: false, message: 'Unauthorized: Valid admin authentication and CSRF token required.' };
    }
  }

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
    case 'reset-all-locks': return resetAllDeviceLocks();
    case 'get-sheet-url': return { ok: true, url: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
    case 'get-config': return { ok: true, config: getConfig() };
    case 'update-config': return updateConfig(params);
    case 'list-logs': return listLogs({ name: params.name, fromDate: params.fromDate, toDate: params.toDate, limit: params.limit, weekStart: params.weekStart });
    case 'log-analytics': return logAnalyticsEvent(params.eventType, params.details, params.deviceId);
    case 'list-analytics': return listAnalyticsEvents(params.limit);
    case 'list-distance-alerts': return listDistanceAlerts(params.limit);
    case 'list-audit-logs': return listAuditLogs(params.limit);
    case 'get-hybrid-schedule': return getHybridSchedule(params.weekStart);
    case 'verify-owner': return verifyOwner({ name: params.name, deviceId: params.deviceId });
    case 'register-owner': return registerOwner({ name: params.name, deviceId: params.deviceId });
    case 'reassign-owner': return reassignOwner({ name: params.name, deviceId: params.deviceId, resetCodeHash: params.resetCodeHash });
    default:
      return processAttendance({ name: params.name, action: params.action, lat: parseFloat(params.lat), lon: parseFloat(params.lon), deviceId: params.deviceId });
  }
}

/* ============================================================
   ADMIN AUTHENTICATION & ACCOUNT SECURITY
   ============================================================ */

function getAdminAccounts() {
  const raw = PropertiesService.getScriptProperties().getProperty('adminAccounts');
  return raw ? JSON.parse(raw) : {};
}

function saveAdminAccounts(accounts) {
  PropertiesService.getScriptProperties().setProperty('adminAccounts', JSON.stringify(accounts));
}

function adminLogin(username, passwordHash) {
  const cleanUsername = sanitizeInput(username, 50).toLowerCase();
  if (!cleanUsername || !passwordHash) return { ok: false, message: 'Username and password are required.' };

  // Rate Limiting Check
  const rateCheck = checkRateLimit('login_' + cleanUsername, 5, 900);
  if (!rateCheck.allowed) return { ok: false, message: rateCheck.message };

  const accounts = getAdminAccounts();
  if (Object.keys(accounts).length === 0) {
    rateCheck.increment();
    return { ok: false, message: 'No admin accounts configured. Contact system administrator.' };
  }

  const account = accounts[cleanUsername];
  if (account && constantTimeCompare(passwordHash, account.passwordHash)) {
    rateCheck.reset();
    const csrfToken = generateSecureToken();
    CacheService.getScriptCache().put('csrf_' + cleanUsername, csrfToken, 3600);
    return { ok: true, message: 'Admin access granted.', role: account.role || 'admin', csrfToken: csrfToken, adminToken: passwordHash };
  }

  rateCheck.increment();
  return { ok: false, message: 'Invalid admin credentials.' };
}

function adminChangePassword(username, currentPasswordHash, newPasswordHash) {
  const cleanUsername = sanitizeInput(username, 50).toLowerCase();
  if (!cleanUsername || !currentPasswordHash || !newPasswordHash) return { ok: false, message: 'Current password verification is required.' };
  
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) return { ok: false, message: 'Account not found.' };
  if (!constantTimeCompare(currentPasswordHash, account.passwordHash)) return { ok: false, message: 'Current password is incorrect.' };
  
  account.passwordHash = newPasswordHash;
  saveAdminAccounts(accounts);
  return { ok: true, message: 'Password updated successfully.' };
}

function adminSetRecoveryEmail(username, currentPasswordHash, email) {
  const cleanUsername = sanitizeInput(username, 50).toLowerCase();
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) return { ok: false, message: 'Account not found.' };
  if (!constantTimeCompare(currentPasswordHash, account.passwordHash)) return { ok: false, message: 'Current password is incorrect.' };
  
  const cleanEmail = sanitizeInput(email, 100);
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, message: 'Enter a valid email address.' };
  
  account.email = cleanEmail;
  saveAdminAccounts(accounts);
  return { ok: true, message: 'Recovery email saved.' };
}

function adminForgotPasswordRequest(username) {
  const cleanUsername = sanitizeInput(username, 50).toLowerCase();
  const genericMessage = 'If that account exists and has a recovery email set, a reset code has been sent.';
  
  const rateCheck = checkRateLimit('forgot_' + cleanUsername, 3, 900);
  if (!rateCheck.allowed) return { ok: false, message: rateCheck.message };
  rateCheck.increment();

  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account || !account.email) return { ok: true, message: genericMessage };

  const rawDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Date.now().toString() + Math.random().toString());
  const num = Math.abs(rawDigest.reduce(function(acc, b) { return acc + (b < 0 ? b + 256 : b); }, 0));
  const code = String(100000 + (num % 900000));
  const expiresAt = Date.now() + 15 * 60 * 1000;
  PropertiesService.getScriptProperties().setProperty('resetCode_' + cleanUsername, JSON.stringify({ code, expiresAt }));

  try {
    MailApp.sendEmail({
      to: account.email,
      subject: 'Lifecard Attendance - Admin Password Reset Code',
      body: 'Your password reset code is: ' + code + '\n\nThis code expires in 15 minutes.'
    });
  } catch (err) {
    return { ok: false, message: 'Could not send recovery email.' };
  }

  return { ok: true, message: genericMessage };
}

function adminForgotPasswordConfirm(username, code, newPasswordHash) {
  const cleanUsername = sanitizeInput(username, 50).toLowerCase();
  const cleanCode = sanitizeInput(code, 10);
  if (!cleanUsername || !cleanCode || !newPasswordHash) return { ok: false, message: 'Missing required fields.' };

  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('resetCode_' + cleanUsername);
  if (!stored) return { ok: false, message: 'No reset code was requested, or it has expired.' };

  const { code: storedCode, expiresAt } = JSON.parse(stored);
  if (Date.now() > expiresAt) {
    props.deleteProperty('resetCode_' + cleanUsername);
    return { ok: false, message: 'This code has expired.' };
  }

  if (!constantTimeCompare(cleanCode, storedCode)) return { ok: false, message: 'Incorrect code.' };

  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) return { ok: false, message: 'Account not found.' };

  account.passwordHash = newPasswordHash;
  saveAdminAccounts(accounts);
  props.deleteProperty('resetCode_' + cleanUsername);

  return { ok: true, message: 'Password reset successfully. You can now log in.' };
}

/* ============================================================
   STAFF MANAGEMENT
   ============================================================ */

function listStaff() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const staff = rows
    .filter(r => r[0] && r[0].toString().trim())
    .map(r => ({ name: r[0].toString().trim(), deviceId: r[1] ? r[1].toString().trim() : '' }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); // Alphabetical A-Z
  return { ok: true, staff: staff };
}

function addStaff(name) {
  const cleanName = sanitizeInput(name, 50);
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const existing = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 1).getValues().flat();
  if (existing.some(i => i.toString().trim().toLowerCase() === cleanName.toLowerCase())) {
    return { ok: false, message: 'Staff member already exists.' };
  }
  staffSheet.appendRow([cleanName, '']);
  return { ok: true, message: 'Staff added successfully.', staff: listStaff().staff };
}

function removeStaff(name) {
  const cleanName = sanitizeInput(name, 50);
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
  return { ok: false, message: 'Staff member not found.' };
}

function resetStaffLock(name) {
  const cleanName = sanitizeInput(name, 50);
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const values = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
      staffSheet.getRange(i + 2, 2).setValue('');
      logSystemEvent('ADMIN_ACTION', 'Staff Device Lock Reset', cleanName, 'Admin cleared device lock for ' + cleanName);
      return { ok: true, message: 'Device lock cleared.', staff: listStaff().staff };
    }
  }
  return { ok: false, message: 'Staff member not found.' };
}

function resetAllDeviceLocks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const lastRow = staffSheet.getLastRow();
  if (lastRow < 2) return { ok: true, message: 'No staff to reset.', staff: [] };
  const numRows = lastRow - 1;
  const clearedValues = Array(numRows).fill(['']);
  staffSheet.getRange(2, 2, numRows, 1).setValues(clearedValues);
  logSystemEvent('ADMIN_ACTION', 'All Device Locks Reset', 'Admin', 'Admin cleared device locks for all staff members');
  return { ok: true, message: 'All device locks cleared.', staff: listStaff().staff };
}

/* ============================================================
   DEVICE OWNERSHIP & VERIFICATION
   ============================================================ */

function validateDeviceId(deviceId) {
  const cleaned = sanitizeInput(deviceId, 200);
  if (!cleaned || cleaned.length < 8) return null;
  return cleaned;
}

function resolveDeviceStatus(name, deviceId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const cleanName = sanitizeInput(name, 50).toLowerCase();
  const cleanDeviceId = validateDeviceId(deviceId);

  let staffExists = false;
  let staffRow = -1;
  let currentStoredDeviceId = '';
  let conflictOwner = null;

  for (let i = 0; i < rows.length; i++) {
    const regName = (rows[i][0] || '').toString().trim();
    if (!regName) continue;
    const regDeviceId = rows[i][1] ? rows[i][1].toString().trim() : '';
    const isCurrentStaff = regName.toLowerCase() === cleanName;

    if (isCurrentStaff) {
      staffExists = true;
      staffRow = i + 2;
      currentStoredDeviceId = regDeviceId;
    } else if (cleanDeviceId && regDeviceId && regDeviceId === cleanDeviceId) {
      conflictOwner = regName;
    }
  }

  return { staffExists, staffRow, currentStoredDeviceId, conflictOwner };
}

function verifyOwner(payload) {
  const cleanDeviceId = validateDeviceId(payload.deviceId);
  if (!cleanDeviceId) return { allowed: false, message: 'Missing or invalid device identifier.' };

  const status = resolveDeviceStatus(payload.name, cleanDeviceId);
  if (!status.staffExists) return { allowed: false, message: 'Staff member not found.' };
  if (status.currentStoredDeviceId) {
    if (status.currentStoredDeviceId === cleanDeviceId) return { allowed: true, message: 'Device verified.' };
    return { allowed: false, message: 'This device is locked to another staff account.' };
  }
  if (status.conflictOwner) return { allowed: false, message: 'This device is locked to another staff account.' };
  return { allowed: true, message: 'No device lock yet. Registration allowed.' };
}

function registerOwner(payload) {
  const cleanDeviceId = validateDeviceId(payload.deviceId);
  if (!cleanDeviceId) return { allowed: false, message: 'Missing or invalid device identifier.' };

  const status = resolveDeviceStatus(payload.name, cleanDeviceId);
  if (!status.staffExists) return { allowed: false, message: 'Staff member not found.' };
  if (!status.currentStoredDeviceId) {
    if (status.conflictOwner) return { allowed: false, message: 'This device is locked to another staff account.' };
    saveStaffDeviceId(payload.name, cleanDeviceId);
    return { allowed: true, message: 'Device registered successfully.' };
  }
  if (status.currentStoredDeviceId === cleanDeviceId) return { allowed: true, message: 'Device already registered.' };
  return { allowed: false, message: 'This device is locked to another staff account.' };
}

function reassignOwner(payload) {
  const cleanDeviceId = validateDeviceId(payload.deviceId);
  if (!cleanDeviceId) return { allowed: false, message: 'Missing or invalid device identifier.' };

  const props = PropertiesService.getScriptProperties();
  const storedResetHash = props.getProperty('adminResetCodeHash');
  if (!storedResetHash) return { allowed: false, message: 'No reset code has been configured by admin.' };
  if (!constantTimeCompare(payload.resetCodeHash, storedResetHash)) return { allowed: false, message: 'Invalid reset code.' };

  saveStaffDeviceId(payload.name, cleanDeviceId);
  return { allowed: true, message: 'Device reassigned successfully.' };
}

/* ============================================================
   LOGS & ATTENDANCE PROCESSING
   ============================================================ */

function listLogs(filters) {
  const cache = CacheService.getScriptCache();
  const cleanName = sanitizeInput(filters.name, 50);
  const cacheKey = 'logs_' + (cleanName || 'all') + '_' + (filters.weekStart || (filters.fromDate || 'none') + '_' + (filters.toDate || 'none')) + '_' + (filters.limit || '100');
  const cached = cache.get(cacheKey);
  if (cached) return { ok: true, logs: JSON.parse(cached) };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs');
  if (!logsSheet || logsSheet.getLastRow() < 2) return { ok: true, logs: [] };

  const lastRow = logsSheet.getLastRow();
  const rowsToRead = Math.min(lastRow - 1, 500);
  const startRow = lastRow - rowsToRead + 1;
  const rows = logsSheet.getRange(startRow, 1, rowsToRead, 6).getValues();

  const nameFilter = cleanName.toLowerCase();
  const limit = filters.limit ? parseInt(filters.limit, 10) : 100;

  let fromDate = null, toDate = null;
  if (filters.weekStart) {
    const monday = parseDdMmYyyy(filters.weekStart);
    if (monday) {
      fromDate = monday;
      toDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4);
    }
  } else {
    fromDate = filters.fromDate ? parseDdMmYyyy(filters.fromDate) : null;
    toDate = filters.toDate ? parseDdMmYyyy(filters.toDate) : null;
  }

  const logs = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[1]) continue;

    let dateStr = '';
    if (row[0] instanceof Date) {
      const d = row[0];
      dateStr = String(d.getDate()).padStart(2, '0') + '/' +
                String(d.getMonth() + 1).padStart(2, '0') + '/' +
                d.getFullYear();
    } else {
      dateStr = row[0].toString().trim();
    }

    if (!dateStr) continue;
    if (nameFilter && row[1].toString().trim().toLowerCase() !== nameFilter) continue;

    if (fromDate || toDate) {
      const entryDate = parseDdMmYyyy(dateStr);
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
  if (limit > 0) logs.splice(limit);
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

const WELCOME_MESSAGES = [
  "Welcome back, {name}. Are you ready to accomplish great things today?",
  "Good to see you, {name}. Let's make today count.",
  "Welcome, {name}. Hope you're ready for a great day ahead!",
  "Hi, {name}. Have a productive day ahead!"
];

const LATE_MESSAGES = [
  "Welcome {name}. It looks like we’re running a bit behind schedule today.",
  "Hi, {name}. We're behind schedule today. Let’s dive in.",
  "Running a bit behind, {name}. Time to get to work.",
  "Welcome, {name}. A slow start today. Let's get things moving."
];

const SIGNOUT_MESSAGES = [
  "Safe trip, {name}! See you tomorrow.",
  "Goodbye, {name}. Have a great evening.",
  "See you later, {name}. Take care!",
  "Thanks for today, {name}. Safe travels."
];

const EARLY_OUT_MESSAGES = [
  "{name}, early sign-out recorded. Take care and see you soon.",
  "Early sign-out noted, {name}. Hope the rest of your day goes well."
];

function pickMessage(arr, name) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  const msg = arr[Math.floor(Math.random() * arr.length)];
  return String(msg).replace(/\{name\}/g, name || '').trim();
}

function processAttendance(payload) {
  const cleanName = sanitizeInput(payload.name, 50);
  const cleanAction = sanitizeInput(payload.action, 10).toUpperCase();

  if (!cleanName || !cleanAction) return 'Missing required fields.';
  if (cleanAction !== 'IN' && cleanAction !== 'OUT') return 'Invalid attendance action.';

  const lat = parseFloat(payload.lat);
  const lon = parseFloat(payload.lon);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return 'Location coordinates are missing or out of bounds.';
  }

  const cleanDeviceId = validateDeviceId(payload.deviceId);
  if (!cleanDeviceId) return 'Missing or invalid device identifier. Please refresh the app and try again.';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs') || ss.insertSheet('Logs');
  const config = getConfig();

  const now = new Date();
  const todayStr = Utilities.formatDate(now, config.timezone, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, config.timezone, 'hh:mm a');
  const hour = now.getHours();
  const nowMinutes = hour * 60 + now.getMinutes();

  const status = resolveDeviceStatus(cleanName, cleanDeviceId);
  if (!status.staffExists) return 'Staff member not recognized. Contact your administrator.';
  if (status.conflictOwner) {
    logSystemEvent('SECURITY_VIOLATION', 'Device Sharing Blocked', cleanName, 'Attempted sign-in on device owned by ' + status.conflictOwner);
    return 'This device is already registered to ' + status.conflictOwner + '. Device sharing is not allowed.';
  }
  if (status.currentStoredDeviceId && status.currentStoredDeviceId !== cleanDeviceId) {
    logSystemEvent('SECURITY_VIOLATION', 'Device Mismatch Blocked', cleanName, 'Account is locked to a different device identifier.');
    return 'Device mismatch. This account is locked to a different phone.';
  }
  if (!status.currentStoredDeviceId && status.staffRow > 0) {
    const staffSheet = getOrCreateStaffSheet(ss);
    staffSheet.getRange(status.staffRow, 2).setValue(cleanDeviceId);
  }

  const dist = getDistance(config.officeLat, config.officeLon, lat, lon);
  if (dist > config.radiusMeters) {
    logDistanceAlert(cleanName, cleanAction, dist, lat, lon);
    return 'Denied. You are too far from the office (' + dist.toFixed(0) + ' meters).|' + dist.toFixed(0);
  }

  const logsLastRow = logsSheet.getLastRow();
  const logsRowsToCheck = Math.min(logsLastRow - 1, 200);
  const logsStartRow = Math.max(2, logsLastRow - logsRowsToCheck + 1);
  const logs = logsRowsToCheck > 0 ? logsSheet.getRange(logsStartRow, 1, logsRowsToCheck, 6).getValues() : [];

  let hasSignedInToday = false, hasSignedOutToday = false;
  let lastAction = '', lastDate = '';

  for (let j = logs.length - 1; j >= 0; j--) {
    if (!logs[j][1]) continue;
    if (logs[j][1].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
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

  if (cleanAction === 'IN' && hasSignedInToday) return 'You have already signed in for today.';
  if (cleanAction === 'OUT' && hasSignedOutToday) return 'You have already signed out for today.';

  let forgotMsg = '';
  if (cleanAction === 'IN' && lastAction === 'IN' && lastDate !== todayStr) {
    logsSheet.appendRow([lastDate, cleanName, 'OUT', 'Missed', 'Missed', '']);
    forgotMsg = ' Note: You forgot to sign out on ' + lastDate;
  }

  let responseStatus = 'NORMAL';
  let logStatus = 'On Time';
  let greeting = '';
  if (cleanAction === 'IN') {
    if (nowMinutes < config.lateCutoffMinutes) {
      responseStatus = 'WELCOME';
      greeting = pickMessage(WELCOME_MESSAGES, cleanName) + forgotMsg;
      logStatus = 'On Time';
    } else {
      responseStatus = 'LATE';
      greeting = pickMessage(LATE_MESSAGES, cleanName) + forgotMsg;
      logStatus = 'Late';
    }
  } else {
    if (!hasSignedInToday) return 'You cannot sign out without signing in first.';
    if (hour < 17) {
      responseStatus = 'LATE';
      greeting = pickMessage(EARLY_OUT_MESSAGES, cleanName) || 'Early sign-out recorded. It is not yet 5:00 PM.';
      logStatus = 'Early Out';
    } else {
      responseStatus = 'NORMAL';
      greeting = pickMessage(SIGNOUT_MESSAGES, cleanName) || ('Safe trip, ' + cleanName + '! See you tomorrow.');
      logStatus = 'On Time';
    }
  }

  logsSheet.appendRow([todayStr, cleanName, cleanAction, timeStr, logStatus, dist.toFixed(0)]);
  return responseStatus + '|' + greeting + '|' + dist.toFixed(0);
}

/* ============================================================
   HYBRID SCHEDULE & CONFIGURATION MANAGEMENT
   ============================================================ */

function buildWeekRangeLabel(monday, friday) {
  const tz = 'GMT+1';
  const startText = Utilities.formatDate(monday, tz, 'MMMM d');
  const endText = Utilities.formatDate(friday, tz, 'MMMM d, yyyy');
  return startText + ' - ' + endText;
}

function buildLegacyWeekRangeLabel(monday, friday) {
  const tz = 'GMT+1';
  const sameMonth = monday.getMonth() === friday.getMonth();
  const sameYear = monday.getFullYear() === friday.getFullYear();
  const startText = Utilities.formatDate(monday, tz, 'MMMM d');
  if (sameMonth && sameYear) {
    return startText + ' - ' + friday.getDate() + ', ' + friday.getFullYear();
  }
  const endText = Utilities.formatDate(friday, tz, 'MMMM d') + (sameYear ? '' : (', ' + friday.getFullYear()));
  return startText + ' - ' + endText;
}

function getHybridSchedule(weekStart) {
  if (!weekStart) return { ok: true, schedule: {} };

  const mondayRequested = parseDdMmYyyy(weekStart);
  if (!mondayRequested) return { ok: true, schedule: {} };
  const fridayRequested = new Date(mondayRequested.getFullYear(), mondayRequested.getMonth(), mondayRequested.getDate() + 4);

  const expectedLabel = buildWeekRangeLabel(mondayRequested, fridayRequested);
  const legacyLabel = buildLegacyWeekRangeLabel(mondayRequested, fridayRequested);

  try {
    const sheetId = getScriptConfigProperty('HYBRID_SCHEDULE_SHEET_ID', (typeof HYBRID_SCHEDULE_SHEET_ID !== 'undefined' ? HYBRID_SCHEDULE_SHEET_ID : ''));
    if (!sheetId) return { ok: true, schedule: {} };
    const scheduleSS = SpreadsheetApp.openById(sheetId);
    const sheet = scheduleSS.getSheets()[0];
    const data = sheet.getDataRange().getValues();

    let matchedJson = null;

    for (let r = 0; r < data.length; r++) {
      const rowKey = data[r][0] ? String(data[r][0]).trim() : '';
      if (rowKey && (rowKey === expectedLabel || rowKey === legacyLabel)) {
        let candidate = data[r][2];
        if (!candidate || !/^[\[{]/.test(String(candidate).trim())) {
          for (let c = 0; c < data[r].length; c++) {
            const cellStr = data[r][c] ? String(data[r][c]).trim() : '';
            if (/^[\[{]/.test(cellStr)) { candidate = cellStr; break; }
          }
        }
        if (candidate) matchedJson = candidate;
      }
    }

    if (!matchedJson) return { ok: true, schedule: {} };

    const jsonSchedule = JSON.parse(String(matchedJson));
    const schedule = {};
    const weekDates = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((dayName, index) => {
        const d = new Date(mondayRequested);
        d.setDate(mondayRequested.getDate() + index);
        return { dayName, date: Utilities.formatDate(d, 'GMT+1', 'dd/MM/yyyy') };
    });

    Object.entries(jsonSchedule || {}).forEach(([rawName, weekMap]) => {
      const staffName = String(rawName || '').trim();
      if (!staffName || typeof weekMap !== 'object' || weekMap === null || Array.isArray(weekMap)) return;
      schedule[staffName] = weekDates.map(({ dayName, date }) => {
        const val = String(weekMap[dayName] || weekMap[dayName.toLowerCase()] || '').toLowerCase();
        return { date, location: (val === 'office' || val === 'on-site' || val === 'present') ? 'office' : 'home' };
      });
    });

    return { ok: true, schedule };
  } catch (err) {
    Logger.log('Hybrid schedule error: ' + err.message);
    return { ok: true, schedule: {} };
  }
}

function updateConfig(params) {
  const allowedKeys = ['OFFICE_LAT', 'OFFICE_LON', 'RADIUS_METERS', 'LATE_CUTOFF_MINUTES'];
  const key = sanitizeInput(params.key, 30);
  const value = sanitizeInput(params.value, 30);

  if (!key || !allowedKeys.includes(key)) return { ok: false, message: 'Invalid configuration key.' };

  if (key === 'OFFICE_LAT') {
    const num = parseFloat(value);
    if (isNaN(num) || num < -90 || num > 90) return { ok: false, message: 'Invalid latitude value (-90 to 90).' };
  } else if (key === 'OFFICE_LON') {
    const num = parseFloat(value);
    if (isNaN(num) || num < -180 || num > 180) return { ok: false, message: 'Invalid longitude value (-180 to 180).' };
  } else if (key === 'RADIUS_METERS') {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 10 || num > 5000) return { ok: false, message: 'Invalid radius. Must be 10-5000.' };
  } else if (key === 'LATE_CUTOFF_MINUTES') {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > 1439) return { ok: false, message: 'Invalid time. Must be between 00:00 and 23:59.' };
  }

  PropertiesService.getScriptProperties().setProperty(key, value);
  logSystemEvent('ADMIN_ACTION', 'Config Key Updated', 'Admin', 'Updated ' + key + ' to ' + value);
  return { ok: true, message: 'Configuration updated successfully.', config: getConfig() };
}

/* ============================================================
   HELPERS & ANALYTICS
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

function getOrCreateAuditLogSheet(ss) {
  let sheet = ss.getSheetByName('Audit Log');
  if (!sheet) {
    sheet = ss.insertSheet('Audit Log');
    sheet.appendRow(['Date', 'Time', 'Category', 'Event Type', 'User / Staff', 'Details']);
  }
  return sheet;
}

function logSystemEvent(category, eventType, user, details) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateAuditLogSheet(ss);
    const now = new Date();
    const config = getConfig();
    const todayStr = Utilities.formatDate(now, config.timezone, 'dd/MM/yyyy');
    const timeStr = Utilities.formatDate(now, config.timezone, 'hh:mm:ss a');

    const cleanCategory = sanitizeInput(category, 30);
    const cleanEventType = sanitizeInput(eventType, 50);
    const cleanUser = sanitizeInput(user, 50);
    const cleanDetails = sanitizeInput(details, 300);

    sheet.appendRow([todayStr, timeStr, cleanCategory, cleanEventType, cleanUser, cleanDetails]);
  } catch (err) {
    Logger.log('Could not log system event: ' + err.message);
  }
}

function logDistanceAlert(name, action, dist, lat, lon) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const alertsSheet = getOrCreateDistanceAlertsSheet(ss);
  const now = new Date();
  const config = getConfig();
  const todayStr = Utilities.formatDate(now, config.timezone, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, config.timezone, 'hh:mm a');
  alertsSheet.appendRow([todayStr, timeStr, name, action, dist.toFixed(0), lat, lon]);

  logSystemEvent(
    'GEOFENCE_VIOLATION',
    'Out-of-Range Attendance Attempt',
    name,
    'Attempted ' + action + ' from ' + dist.toFixed(0) + ' meters away (Allowed: ' + config.radiusMeters + 'm) | Lat: ' + lat + ', Lon: ' + lon
  );
}

function saveStaffDeviceId(name, deviceId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const cleanName = sanitizeInput(name, 50).toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0].toString().trim().toLowerCase() === cleanName) {
      staffSheet.getRange(i + 2, 2).setValue(deviceId || '');
      return;
    }
  }
  staffSheet.appendRow([name, deviceId || '']);
}

function logAnalyticsEvent(eventType, details, deviceId) {
  if (!eventType) return { ok: false };
  const props = PropertiesService.getScriptProperties();
  let events = [];
  try { events = JSON.parse(props.getProperty('analyticsEvents') || '[]'); } catch (e) { events = []; }
  const config = getConfig();
  const now = new Date();
  events.unshift({
    type: sanitizeInput(eventType, 50),
    details: sanitizeInput(details, 200),
    deviceId: sanitizeInput(deviceId, 100),
    time: Utilities.formatDate(now, config.timezone, 'dd/MM/yyyy HH:mm:ss')
  });
  if (events.length > 100) events = events.slice(0, 100);
  try {
    props.setProperty('analyticsEvents', JSON.stringify(events));
  } catch (e) {
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

function listDistanceAlerts(limit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const alertsSheet = ss.getSheetByName('Distance Alerts');
  if (!alertsSheet || alertsSheet.getLastRow() < 2) return { ok: true, alerts: [] };

  const lastRow = alertsSheet.getLastRow();
  const cap = limit ? parseInt(limit, 10) : 100;
  const rowsToRead = Math.min(lastRow - 1, Math.max(cap, 100));
  const startRow = lastRow - rowsToRead + 1;
  const rows = alertsSheet.getRange(startRow, 1, rowsToRead, 7).getValues();

  const alerts = rows.map(function (row) {
    return {
      date: row[0] ? row[0].toString().trim() : '',
      time: row[1] ? row[1].toString().trim() : '',
      name: row[2] ? row[2].toString().trim() : '',
      action: row[3] ? row[3].toString().trim() : '',
      distance: row[4] !== undefined && row[4] !== '' ? row[4].toString() : '',
      lat: row[5] !== undefined ? row[5].toString() : '',
      lon: row[6] !== undefined ? row[6].toString() : ''
    };
  }).reverse();

  return { ok: true, alerts: alerts.slice(0, cap) };
}

function listAuditLogs(limit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Audit Log');
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, events: [] };

  const lastRow = sheet.getLastRow();
  const cap = limit ? parseInt(limit, 10) : 100;
  const rowsToRead = Math.min(lastRow - 1, Math.max(cap, 100));
  const startRow = lastRow - rowsToRead + 1;
  const rows = sheet.getRange(startRow, 1, rowsToRead, 6).getValues();

  const events = rows.map(function (row) {
    return {
      date: row[0] ? row[0].toString().trim() : '',
      time: row[1] ? row[1].toString().trim() : '',
      category: row[2] ? row[2].toString().trim() : '',
      eventType: row[3] ? row[3].toString().trim() : '',
      user: row[4] ? row[4].toString().trim() : '',
      details: row[5] ? row[5].toString().trim() : ''
    };
  }).reverse();

  return { ok: true, events: events.slice(0, cap) };
}
