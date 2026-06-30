/** @typedef {GoogleAppsScript} */

// Configuration is now loaded from Script Properties for runtime flexibility
// Default values are used if properties are not set
const DEFAULT_CONFIG = {
    OFFICE_LAT: 6.4518631,
    OFFICE_LON: 3.5277863,
    RADIUS_METERS: 200,
    TIMEZONE: 'GMT+1'
};

/**
 * Entry point for GET requests (JSONP fallback path).
 * @param {{ parameter: { callback: string; }; }} e
 */
function doGet(e) {
  const result = routeRequest(e.parameter);
  const callback = e.parameter.callback || 'callback';
  return ContentService.createTextOutput(callback + '(' + JSON.stringify({ result }) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/**
 * Entry point for POST requests (preferred path - keeps secrets out
 * of any URL/access log). Body is sent as text/plain by the client to
 * avoid a CORS preflight; we parse it as JSON here.
 * @param {{ postData: { contents: string; }; }} e
 */
function doPost(e) {
  let params = {};
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, allowed: false, message: 'Malformed request body.' });
  }
  
  // CSRF validation - reject requests without valid token
  const csrfToken = params.csrfToken;
  if (!csrfToken || !isValidCsrfToken(csrfToken)) {
    return jsonOutput({ ok: false, message: 'Invalid or missing CSRF token.' });
  }
  
  const result = routeRequest(params);
  return jsonOutput(result);
}

function isValidCsrfToken(token) {
  if (!token || typeof token !== 'string') return false;
  // Accept tokens that are 64-character hex strings (32 bytes)
  return /^[a-f0-9]{64}$/i.test(token);
}

/**
 * @param {string | { ok: boolean; message: string; } | Promise<Object> | { allowed: boolean; message: string; }} result
 */
function jsonOutput(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Shared routing logic for both GET (JSONP) and POST (JSON) entry points.
 * All "secret" fields (passwordHash, resetCodeHash) are expected to
 * already be SHA-256 hex digests produced by the client - this script
 * never sees or stores raw passwords.
 * @param {{ mode?: any; username?: any; passwordHash?: any; currentPasswordHash?: any; newPasswordHash?: any; code?: any; name?: any; deviceId?: any; resetCodeHash?: any; action?: any; lat?: any; lon?: any; }} params
 */
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
    case 'admin-login':
      return adminLogin(params.username, params.passwordHash);
    case 'admin-change-password':
      return adminChangePassword(params.username, params.currentPasswordHash, params.newPasswordHash);
    case 'admin-set-recovery-email':
      return adminSetRecoveryEmail(params.username, params.currentPasswordHash, params.email);
    case 'admin-forgot-password-request':
      return adminForgotPasswordRequest(params.username);
    case 'admin-forgot-password-confirm':
      return adminForgotPasswordConfirm(params.username, params.code, params.newPasswordHash);
    case 'list-staff':
      return listStaff();
    case 'add-staff':
      return addStaff(params.name);
    case 'remove-staff':
      return removeStaff(params.name);
    case 'reset-staff-lock':
      return resetStaffLock(params.name);
    case 'get-config':
      return { ok: true, config: getConfig() };
    case 'update-config':
      return updateConfig(params);
    case 'list-logs':
      return listLogs({ name: params.name, fromDate: params.fromDate, toDate: params.toDate, limit: params.limit });
    case 'verify-owner':
      return verifyOwner({ name: params.name, deviceId: params.deviceId });
    case 'register-owner':
      return registerOwner({ name: params.name, deviceId: params.deviceId });
    case 'reassign-owner':
      return reassignOwner({
        name: params.name,
        deviceId: params.deviceId,
        resetCodeHash: params.resetCodeHash
      });
    default:
      return processAttendance({
        name: params.name,
        action: params.action,
        lat: parseFloat(params.lat),
        lon: parseFloat(params.lon),
        deviceId: params.deviceId
      });
  }
}

/* ============================================================
   ADMIN AUTH - multi-admin
   Admin accounts are stored as a JSON object in Script Properties
   under 'adminAccounts', keyed by lowercase username:
     { "<username>": { passwordHash, email, role } }
   Passwords are always SHA-256 hashes - this script never sees or
   stores raw passwords. The client hashes before sending.

   A separate, fixed developer fallback account (DEVELOPER_USERNAME /
   DEVELOPER_PASSWORD_HASH below) exists outside this stored object
   entirely, so it can never be locked out even if adminAccounts gets
   corrupted or every other admin is removed/forgotten. Set its hash
   once via setDeveloperPasswordOnce() and keep the plaintext private.
   ============================================================ */

const DEVELOPER_USERNAME = 'kaycee-dev';

function getAdminAccounts() {
  const raw = PropertiesService.getScriptProperties().getProperty('adminAccounts');
  return raw ? JSON.parse(raw) : {};
}

/**
 * @param {any} accounts
 */
function saveAdminAccounts(accounts) {
  PropertiesService.getScriptProperties().setProperty('adminAccounts', JSON.stringify(accounts));
}

/**
 * @param {string} username
 * @param {string} passwordHash
 */
function adminLogin(username, passwordHash) {
  if (!username || !passwordHash) {
    return { ok: false, message: 'Username and password are required.' };
  }
  const cleanUsername = username.trim().toLowerCase();

  // Developer fallback - checked first, never lockable via the normal flow.
  const devHash = PropertiesService.getScriptProperties().getProperty('developerPasswordHash');
  if (cleanUsername === DEVELOPER_USERNAME.toLowerCase() && devHash) {
    if (passwordHash === devHash) {
      return { ok: true, message: 'Developer access granted.', role: 'developer' };
    }
    return { ok: false, message: 'Invalid admin credentials.' };
  }

  const accounts = getAdminAccounts();

  // First-run bootstrap: if no admin accounts exist yet at all, accept
  // this login as the initial company-admin setup.
  if (Object.keys(accounts).length === 0) {
    accounts[cleanUsername] = { passwordHash, email: '', role: 'admin' };
    saveAdminAccounts(accounts);
    return { ok: true, message: 'Initial admin account created. Please remember these credentials and set a recovery email from the admin panel.', role: 'admin' };
  }

  const account = accounts[cleanUsername];
  if (account && passwordHash === account.passwordHash) {
    return { ok: true, message: 'Admin access granted.', role: account.role || 'admin' };
  }
  return { ok: false, message: 'Invalid admin credentials.' };
}

/**
 * In-portal password change - used when already logged in and the
 * current password is known. Distinct from the forgot-password flow.
 * @param {string} username
 * @param {any} currentPasswordHash
 * @param {any} newPasswordHash
 */
function adminChangePassword(username, currentPasswordHash, newPasswordHash) {
  if (!username || !currentPasswordHash || !newPasswordHash) {
    return { ok: false, message: 'Current password verification is required to change password.' };
  }
  const cleanUsername = username.trim().toLowerCase();
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) {
    return { ok: false, message: 'Account not found.' };
  }
  if (currentPasswordHash !== account.passwordHash) {
    return { ok: false, message: 'Current password is incorrect. Password not changed.' };
  }
  account.passwordHash = newPasswordHash;
  saveAdminAccounts(accounts);
  return { ok: true, message: 'Password updated.' };
}

/**
 * Sets or updates the recovery email for an admin account. Requires
 * being logged in (current password), since this controls where
 * future forgot-password codes get sent.
 * @param {any} username
 * @param {any} currentPasswordHash
 * @param {string} email
 */
function adminSetRecoveryEmail(username, currentPasswordHash, email) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) return { ok: false, message: 'Account not found.' };
  if (currentPasswordHash !== account.passwordHash) {
    return { ok: false, message: 'Current password is incorrect.' };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }
  account.email = email.trim();
  saveAdminAccounts(accounts);
  return { ok: true, message: 'Recovery email saved.' };
}

/**
 * Forgot-password step 1: sends a 6-digit code to the email already
 * on file for this account. Does not reveal whether the username
 * exists, to avoid leaking valid usernames to an attacker.
 * @param {any} username
 */
function adminForgotPasswordRequest(username) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  const genericMessage = 'If that account exists and has a recovery email set, a code has been sent.';

  if (!account || !account.email) {
    return { ok: true, message: genericMessage };
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

  PropertiesService.getScriptProperties().setProperty(
    'resetCode_' + cleanUsername,
    JSON.stringify({ code, expiresAt })
  );

  try {
    MailApp.sendEmail({
      to: account.email,
      subject: 'Lifecard Attendance - Admin Password Reset Code',
      body: 'Your password reset code is: ' + code + '\n\nThis code expires in 15 minutes. If you did not request this, you can ignore this email.'
    });
  } catch (err) {
    return { ok: false, message: 'Could not send recovery email. Contact your developer.' };
  }

  return { ok: true, message: genericMessage };
}

/**
 * Forgot-password step 2: verifies the emailed code and sets a new
 * password. No knowledge of the old password is required - this is
 * the actual "I forgot my password" path.
 * @param {any} username
 * @param {string} code
 * @param {any} newPasswordHash
 */
function adminForgotPasswordConfirm(username, code, newPasswordHash) {
  const cleanUsername = (username || '').trim().toLowerCase();
  if (!cleanUsername || !code || !newPasswordHash) {
    return { ok: false, message: 'Missing required fields.' };
  }
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('resetCode_' + cleanUsername);
  if (!stored) {
    return { ok: false, message: 'No reset code was requested, or it already expired. Request a new one.' };
  }
  const { code: storedCode, expiresAt } = JSON.parse(stored);
  if (Date.now() > expiresAt) {
    props.deleteProperty('resetCode_' + cleanUsername);
    return { ok: false, message: 'This code has expired. Request a new one.' };
  }
  if (code.trim() !== storedCode) {
    return { ok: false, message: 'Incorrect code.' };
  }

  const accounts = getAdminAccounts();
  const account = accounts[cleanUsername];
  if (!account) {
    return { ok: false, message: 'Account not found.' };
  }
  account.passwordHash = newPasswordHash;
  saveAdminAccounts(accounts);
  props.deleteProperty('resetCode_' + cleanUsername);
  return { ok: true, message: 'Password reset. You can now log in with your new password.' };
}

/**
 * Run once manually from the Apps Script editor to create the fixed
 * developer fallback account. This account is intentionally outside
 * adminAccounts so it survives even if all other admins are removed.
 * Change DEV_PASSWORD_PLAINTEXT below, run this once, then keep the
 * plaintext private - only the hash is stored.
 */
function setDeveloperPasswordOnce() {
  const DEV_PASSWORD_PLAINTEXT = 'change-this-before-running'; // change this before running
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, DEV_PASSWORD_PLAINTEXT)
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('');
  PropertiesService.getScriptProperties().setProperty('developerPasswordHash', hash);
  Logger.log('Developer password hash stored for username: ' + DEVELOPER_USERNAME);
}

/**
 * Run once manually to create an additional company-admin account
 * (or to add more admins later) without going through the first-run
 * bootstrap flow. Edit the values below before running.
 */
function addAdminAccountOnce() {
  const NEW_USERNAME = 'company-admin'; // change this
  const NEW_PASSWORD_PLAINTEXT = 'change-this-before-running'; // change this
  const NEW_EMAIL = 'admin@example.com'; // change this - required for forgot-password to work

  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, NEW_PASSWORD_PLAINTEXT)
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('');
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
  const staff = rows
    .filter((/** @type {{ toString: () => string; }[]} */ row) => row[0] && row[0].toString().trim())
    .map((/** @type {{ toString: () => string; }[]} */ row) => ({
      name: row[0].toString().trim(),
      deviceId: row[1] ? row[1].toString().trim() : ''
    }));
  return { ok: true, staff: staff };
}

/**
 * Returns attendance log entries, most recent first, optionally
 * filtered by staff name and/or date range (inclusive, format
 * dd/MM/yyyy to match how dates are stored). Defaults to the most
 * recent 100 entries if no limit is given, to avoid returning a
 * year's worth of rows in one call.
 * @param {{ name?: any; fromDate?: any; toDate?: any; limit?: any; }} filters
 */
function listLogs(filters) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs');
  if (!logsSheet || logsSheet.getLastRow() < 2) {
    return { ok: true, logs: [] };
  }
  const rows = logsSheet.getRange(2, 1, logsSheet.getLastRow() - 1, 6).getValues();
  const nameFilter = (filters.name || '').toString().trim().toLowerCase();
  const fromDate = filters.fromDate ? parseDdMmYyyy(filters.fromDate) : null;
  const toDate = filters.toDate ? parseDdMmYyyy(filters.toDate) : null;
  const limit = filters.limit ? parseInt(filters.limit, 10) : 100;

  let logs = rows
    .filter((/** @type {any[]} */ row) => row[1])
    .map((/** @type {any[]} */ row) => ({
      date: row[0] instanceof Date ? Utilities.formatDate(row[0], 'GMT+1', 'dd/MM/yyyy') : row[0].toString(),
      name: row[1].toString().trim(),
      action: row[2] ? row[2].toString().trim() : '',
      time: row[3] ? row[3].toString().trim() : '',
      status: row[4] ? row[4].toString().trim() : '',
      distance: row[5] !== undefined && row[5] !== '' ? row[5].toString() : ''
    }))
    .filter((/** @type {{ name: string; date: string; }} */ entry) => {
      if (nameFilter && entry.name.toLowerCase() !== nameFilter) return false;
      if (fromDate || toDate) {
        const entryDate = parseDdMmYyyy(entry.date);
        if (!entryDate) return true; // don't drop rows we can't parse
        if (fromDate && entryDate < fromDate) return false;
        if (toDate && entryDate > toDate) return false;
      }
      return true;
    });

  logs.reverse(); // most recent first
  if (limit > 0) logs = logs.slice(0, limit);

  return { ok: true, logs: logs };
}

/**
 * @param {any} str
 */
function parseDdMmYyyy(str) {
  if (!str) return null;
  const parts = str.toString().split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map((/** @type {string} */ p) => parseInt(p, 10));
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd);
}

/**
 * @param {any} name
 */
function addStaff(name) {
  const cleanName = (name || '').toString().trim();
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const existing = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 1).getValues().flat();
  if (existing.some((/** @type {{ toString: () => string; }} */ item) => item.toString().trim().toLowerCase() === cleanName.toLowerCase())) {
    return { ok: false, message: 'Staff already exists.' };
  }
  staffSheet.appendRow([cleanName, '']);
  return { ok: true, message: 'Staff added.', staff: listStaff().staff };
}

/**
 * @param {any} name
 */
function removeStaff(name) {
  const cleanName = (name || '').toString().trim();
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const values = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 1).getValues();
  let removed = false;
  for (let i = 0; i < values.length; i++) {
    if (values[i][0].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
      staffSheet.deleteRow(i + 2);
      removed = true;
      break;
    }
  }
  if (!removed) return { ok: false, message: 'Staff not found.' };
  return { ok: true, message: 'Staff removed.', staff: listStaff().staff };
}

/**
 * @param {any} name
 */
function resetStaffLock(name) {
  const cleanName = (name || '').toString().trim();
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const values = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  let updated = false;
  for (let i = 0; i < values.length; i++) {
    if (values[i][0].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
      staffSheet.getRange(i + 2, 2).setValue('');
      updated = true;
      break;
    }
  }
  if (!updated) return { ok: false, message: 'Staff not found.' };
  return { ok: true, message: 'Staff lock reset.', staff: listStaff().staff };
}

/* ============================================================
   DEVICE OWNERSHIP
   All device-lock enforcement happens here, server-side. The
   client may also show its own lock message for instant feedback,
   but it can never bypass these checks - the spreadsheet is the
   source of truth and processAttendance() re-validates regardless
   of what the client claims.
   ============================================================ */

/**
 * @param {{ name: any; deviceId: any; }} payload
 */
function verifyOwner(payload) {
  const staff = findStaffRecord(payload.name);
  if (!staff) return { allowed: false, message: 'Staff not found.' };
  const storedDeviceId = staff.deviceId || '';
  if (!storedDeviceId) {
    return { allowed: true, message: 'No device lock yet. Registration allowed.' };
  }
  if (storedDeviceId === payload.deviceId) {
    return { allowed: true, message: 'Device verified.' };
  }
  return { allowed: false, message: 'This device is locked to another staff account.' };
}

/**
 * @param {{ name: any; deviceId: any; }} payload
 */
function registerOwner(payload) {
  const staff = findStaffRecord(payload.name);
  if (!staff) return { allowed: false, message: 'Staff not found.' };
  const storedDeviceId = staff.deviceId || '';
  if (!storedDeviceId) {
    saveStaffDeviceId(payload.name, payload.deviceId);
    return { allowed: true, message: 'Device registered.' };
  }
  if (storedDeviceId === payload.deviceId) {
    return { allowed: true, message: 'Device already registered.' };
  }
  return { allowed: false, message: 'This device is locked to another staff account.' };
}

/**
 * @param {{ name: any; deviceId: any; resetCodeHash: any; }} payload
 */
function reassignOwner(payload) {
  const props = PropertiesService.getScriptProperties();
  const storedResetHash = props.getProperty('adminResetCodeHash');
  if (!storedResetHash) {
    return { allowed: false, message: 'No reset code has been configured by the admin yet.' };
  }
  if (payload.resetCodeHash !== storedResetHash) {
    return { allowed: false, message: 'Invalid reset code.' };
  }
  saveStaffDeviceId(payload.name, payload.deviceId);
  return { allowed: true, message: 'Device reassigned.' };
}

/* ============================================================
   ATTENDANCE
   ============================================================ */

/**
 * @param {{ name: any; action: any; lat: any; lon: any; deviceId: any; }} payload
 */
function processAttendance(payload) {
  if (!payload.name || !payload.action) {
    return 'BLOCK|Missing required fields.';
  }
  if (isNaN(payload.lat) || isNaN(payload.lon)) {
    return 'BLOCK|Location data is missing or invalid. Please enable GPS and try again.';
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs') || ss.insertSheet('Logs');
  const staffSheet = getOrCreateStaffSheet(ss);
  const config = getConfig();

  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = Utilities.formatDate(todayDate, config.timezone, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, config.timezone, 'hh:mm a');
  const hour = now.getHours();

  const staffData = staffSheet.getDataRange().getValues();
  let staffRow = -1;
  let staffExists = false;

  const incomingParts = (payload.deviceId || '').split('-');
  const incomingHW = incomingParts[1] || '';
  const incomingSalt = incomingParts[2] || '';

  for (let i = 1; i < staffData.length; i++) {
    const regName = staffData[i][0].toString().trim();
    if (!regName) continue;
    const regFullID = staffData[i][1] ? staffData[i][1].toString().trim() : '';
    const regParts = regFullID.split('-');
    const regHW = regParts[1] || '';
    const regSalt = regParts[2] || '';
    const isCurrentStaff = regName.toLowerCase() === payload.name.trim().toLowerCase();

    if (isCurrentStaff) staffExists = true;

    if (regFullID !== '') {
      if (isCurrentStaff) {
        staffRow = i + 1;
        if (incomingHW !== regHW && incomingSalt !== regSalt) {
          return 'BLOCK|Device mismatch. This account is locked to a different phone.';
        }
        if (regFullID !== payload.deviceId) {
          staffSheet.getRange(staffRow, 2).setValue(payload.deviceId);
        }
      } else if (incomingHW === regHW || incomingSalt === regSalt) {
        return 'BLOCK|This device is already registered to ' + regName + '. Device sharing is not allowed.';
      }
    } else if (isCurrentStaff) {
      staffRow = i + 1;
      staffSheet.getRange(staffRow, 2).setValue(payload.deviceId);
    }
  }

  if (!staffExists) {
    return 'BLOCK|Staff member not recognized. Contact your administrator.';
  }

  const dist = getDistance(config.officeLat, config.officeLon, payload.lat, payload.lon);
  if (dist > config.radiusMeters) {
    logDistanceAlert(payload.name, payload.action, dist, payload.lat, payload.lon);
    return 'BLOCK|Denied. You are too far from the office (' + dist.toFixed(0) + 'm).|' + dist.toFixed(0);
  }

  const logs = logsSheet.getDataRange().getValues();
  let hasSignedInToday = false;
  let hasSignedOutToday = false;
  let lastAction = '';
  let lastDate = '';

  for (let j = logs.length - 1; j >= 1; j--) {
    if (!logs[j][1]) continue;
    if (logs[j][1].toString().trim().toLowerCase() === payload.name.trim().toLowerCase()) {
      const logDate = Utilities.formatDate(new Date(logs[j][0]), 'GMT+1', 'dd/MM/yyyy');
      if (lastAction === '') {
        lastAction = logs[j][2];
        lastDate = logDate;
      }
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
    logsSheet.appendRow([new Date(lastDate.split('/').reverse().join('-')), payload.name, 'OUT', 'Missed', 'Auto-logged']);
    forgotMsg = '. Note: You forgot to sign out on ' + lastDate;
  }

  let status = 'NORMAL';
  let greeting = '';
  if (payload.action === 'IN') {
    if (hour < 9) {
      status = 'WELCOME';
      greeting = 'Welcome! Have a productive day' + forgotMsg;
    } else {
      status = 'LATE';
      greeting = 'You are late' + forgotMsg;
    }
  } else {
    if (!hasSignedInToday) return 'BLOCK|You cannot sign out without signing in first.';
    if (hour < 17) {
      status = 'LATE';
      greeting = 'Early sign-out recorded. It is not yet 5:00 PM.';
    } else {
      status = 'NORMAL';
      greeting = 'Safe trip, ' + payload.name + '! See you tomorrow.';
    }
  }

  logsSheet.appendRow([todayDate, payload.name, payload.action, timeStr, 'Verified', dist.toFixed(0)]);
  return status + '|' + greeting + '|' + dist.toFixed(0);
}

/* ============================================================
   CONFIGURATION MANAGEMENT
   ============================================================ */

/**
 * Updates configuration values in Script Properties.
 * Only allows updating specific config keys for security.
 * @param {{ key?: string; value?: string; }} params
 */
function updateConfig(params) {
  const allowedKeys = ['OFFICE_LAT', 'OFFICE_LON', 'RADIUS_METERS', 'TIMEZONE'];
  const key = params.key;
  const value = params.value;
  
  if (!key || !allowedKeys.includes(key)) {
    return { ok: false, message: 'Invalid configuration key. Allowed keys: ' + allowedKeys.join(', ') };
  }
  
  // Validate values
  if (key === 'OFFICE_LAT' || key === 'OFFICE_LON') {
    const num = parseFloat(value);
    if (isNaN(num) || num < -90 || num > 90) {
      return { ok: false, message: 'Invalid coordinate value. Must be between -90 and 90.' };
    }
  } else if (key === 'RADIUS_METERS') {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 10 || num > 5000) {
      return { ok: false, message: 'Invalid radius. Must be between 10 and 5000 meters.' };
    }
  } else if (key === 'TIMEZONE') {
    if (!/^GMT[+-]\d{1,2}$/.test(value)) {
      return { ok: false, message: 'Invalid timezone format. Use GMT+1, GMT-5, etc.' };
    }
  }
  
  const props = PropertiesService.getScriptProperties();
  props.setProperty(key, value.toString());
  
  return { 
    ok: true, 
    message: 'Configuration updated.',
    config: getConfig()
  };
}

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function getOrCreateStaffSheet(ss) {
  let staffSheet = ss.getSheetByName('Staff');
  if (!staffSheet) {
    staffSheet = ss.insertSheet('Staff');
    staffSheet.appendRow(['Name', 'Device ID']);
  }
  return staffSheet;
}

/**
 * Records every attendance attempt blocked for being outside the
 * allowed radius - kept on a separate sheet from Logs since these
 * are non-events (no attendance was actually recorded), useful for
 * spotting GPS spoofing, a misconfigured RADIUS_METERS, or staff
 * regularly hovering just outside the boundary.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function getOrCreateDistanceAlertsSheet(ss) {
  let alertsSheet = ss.getSheetByName('Distance Alerts');
  if (!alertsSheet) {
    alertsSheet = ss.insertSheet('Distance Alerts');
    alertsSheet.appendRow(['Date', 'Time', 'Name', 'Action', 'Distance(m)', 'Lat', 'Lon']);
  }
  return alertsSheet;
}

/**
 * @param {any} name
 * @param {any} action
 * @param {number} dist
 * @param {any} lat
 * @param {any} lon
 */
function logDistanceAlert(name, action, dist, lat, lon) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const alertsSheet = getOrCreateDistanceAlertsSheet(ss);
  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const timeStr = Utilities.formatDate(now, 'GMT+1', 'hh:mm a');
  alertsSheet.appendRow([todayDate, timeStr, name, action, dist.toFixed(0), lat, lon]);
}

/**
 * @param {any} name
 */
function findStaffRecord(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const cleanName = (name || '').toString().trim().toLowerCase();
  const match = rows.find((/** @type {{ toString: () => string; }[]} */ row) => row[0].toString().trim().toLowerCase() === cleanName);
  if (!match) return null;
  return { name: match[0].toString().trim(), deviceId: match[1] ? match[1].toString().trim() : '' };
}

/**
 * @param {any} name
 * @param {any} deviceId
 */
function saveStaffDeviceId(name, deviceId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const cleanName = (name || '').toString().trim().toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0].toString().trim().toLowerCase() === cleanName) {
      staffSheet.getRange(i + 2, 2).setValue(deviceId || '');
      return;
    }
  }
  staffSheet.appendRow([name, deviceId || '']);
}

/**
 * Run this once manually from the Apps Script editor to set the
 * device-reset code as a hash, instead of leaving it hardcoded in
 * client-side JS. Change RESET_CODE_PLAINTEXT below, run this
 * function once, then delete/ignore it - the hash is what's stored.
 */
function setDeviceResetCodeOnce() {
  const RESET_CODE_PLAINTEXT = 'lifecard-admin-reset'; // change this before running
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, RESET_CODE_PLAINTEXT)
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('');
  PropertiesService.getScriptProperties().setProperty('adminResetCodeHash', hash);
  Logger.log('Reset code hash stored. Distribute the plaintext code to admins only.');
}
