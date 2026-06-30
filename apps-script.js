const OFFICE_LAT = 6.4518631;
const OFFICE_LON = 3.5277863;
const RADIUS_METERS = 200;

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
 * Entry point for POST requests (preferred path - keeps secrets out
 * of any URL/access log). Body is sent as text/plain by the client to
 * avoid a CORS preflight; we parse it as JSON here.
 */
function doPost(e) {
  let params = {};
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, allowed: false, message: 'Malformed request body.' });
  }
  const result = routeRequest(params);
  return jsonOutput(result);
}

function jsonOutput(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Shared routing logic for both GET (JSONP) and POST (JSON) entry points.
 * All "secret" fields (passwordHash, resetCodeHash) are expected to
 * already be SHA-256 hex digests produced by the client - this script
 * never sees or stores raw passwords.
 */
function routeRequest(params) {
  const mode = params.mode || 'attendance';

  switch (mode) {
    case 'admin-login':
      return adminLogin(params.username, params.passwordHash);
    case 'admin-reset-password':
      return adminResetPassword(params.username, params.newPasswordHash, params.currentPasswordHash);
    case 'list-staff':
      return listStaff();
    case 'add-staff':
      return addStaff(params.name);
    case 'remove-staff':
      return removeStaff(params.name);
    case 'reset-staff-lock':
      return resetStaffLock(params.name);
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
   ADMIN AUTH
   Passwords are stored as SHA-256 hashes in Script Properties,
   never in plaintext. The client hashes before sending; this
   script only ever compares hash-to-hash.
   ============================================================ */

function adminLogin(username, passwordHash) {
  if (!username || !passwordHash) {
    return { ok: false, message: 'Username and password are required.' };
  }
  const props = PropertiesService.getScriptProperties();
  const storedUser = props.getProperty('adminUsername');
  const storedHash = props.getProperty('adminPasswordHash');

  // First-run bootstrap: if no admin has ever been configured, accept
  // this login as the initial setup and store the provided credentials.
  if (!storedUser || !storedHash) {
    props.setProperty('adminUsername', username);
    props.setProperty('adminPasswordHash', passwordHash);
    return { ok: true, message: 'Initial admin account created. Please remember these credentials.' };
  }

  if (username === storedUser && passwordHash === storedHash) {
    return { ok: true, message: 'Admin access granted.' };
  }
  return { ok: false, message: 'Invalid admin credentials.' };
}

function adminResetPassword(username, newPasswordHash, currentPasswordHash) {
  if (!username || !newPasswordHash || !currentPasswordHash) {
    return { ok: false, message: 'Current password verification is required to reset.' };
  }
  const props = PropertiesService.getScriptProperties();
  const storedUser = props.getProperty('adminUsername');
  const storedHash = props.getProperty('adminPasswordHash');

  if (!storedUser || !storedHash) {
    return { ok: false, message: 'No admin account exists yet. Log in first to create one.' };
  }
  if (username !== storedUser || currentPasswordHash !== storedHash) {
    return { ok: false, message: 'Current credentials are incorrect. Password not changed.' };
  }
  props.setProperty('adminPasswordHash', newPasswordHash);
  return { ok: true, message: 'Admin password updated.' };
}

/* ============================================================
   STAFF MANAGEMENT
   ============================================================ */

function listStaff() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const staff = rows
    .filter((row) => row[0] && row[0].toString().trim())
    .map((row) => ({
      name: row[0].toString().trim(),
      deviceId: row[1] ? row[1].toString().trim() : ''
    }));
  return { ok: true, staff: staff };
}

function addStaff(name) {
  const cleanName = (name || '').toString().trim();
  if (!cleanName) return { ok: false, message: 'Staff name is required.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const existing = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 1).getValues().flat();
  if (existing.some((item) => item.toString().trim().toLowerCase() === cleanName.toLowerCase())) {
    return { ok: false, message: 'Staff already exists.' };
  }
  staffSheet.appendRow([cleanName, '']);
  return { ok: true, message: 'Staff added.', staff: listStaff().staff };
}

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

  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = Utilities.formatDate(todayDate, 'GMT+1', 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, 'GMT+1', 'hh:mm a');
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

  const dist = getDistance(OFFICE_LAT, OFFICE_LON, payload.lat, payload.lon);
  if (dist > RADIUS_METERS) {
    return 'BLOCK|Denied. You are too far from the office (' + dist.toFixed(0) + 'm).';
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

  logsSheet.appendRow([todayDate, payload.name, payload.action, timeStr, 'Verified']);
  return status + '|' + greeting;
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
  if (!staffSheet) {
    staffSheet = ss.insertSheet('Staff');
    staffSheet.appendRow(['Name', 'Device ID']);
  }
  return staffSheet;
}

function findStaffRecord(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = getOrCreateStaffSheet(ss);
  const rows = staffSheet.getRange(2, 1, Math.max(staffSheet.getLastRow() - 1, 0), 2).getValues();
  const cleanName = (name || '').toString().trim().toLowerCase();
  const match = rows.find((row) => row[0].toString().trim().toLowerCase() === cleanName);
  if (!match) return null;
  return { name: match[0].toString().trim(), deviceId: match[1] ? match[1].toString().trim() : '' };
}

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
  const RESET_CODE_PLAINTEXT = 'lifecard-reset-2026'; // change this before running
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, RESET_CODE_PLAINTEXT)
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('');
  PropertiesService.getScriptProperties().setProperty('adminResetCodeHash', hash);
  Logger.log('Reset code hash stored. Distribute the plaintext code to admins only.');
}
