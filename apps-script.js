const OFFICE_LAT = 6.4518631;
const OFFICE_LON = 3.5277863;
const RADIUS_METERS = 100;

function doGet(e) {
  const callback = e.parameter.callback || 'callback';
  const mode = e.parameter.mode || 'attendance';

  let result;
  switch (mode) {
    case 'admin-login':
      result = adminLogin(e.parameter.username, e.parameter.password);
      break;
    case 'admin-reset-password':
      result = adminResetPassword(e.parameter.username, e.parameter.newPassword);
      break;
    case 'list-staff':
      result = listStaff();
      break;
    case 'add-staff':
      result = addStaff(e.parameter.name);
      break;
    case 'remove-staff':
      result = removeStaff(e.parameter.name);
      break;
    case 'reset-staff-lock':
      result = resetStaffLock(e.parameter.name);
      break;
    case 'verify-owner':
      result = verifyOwner({
        name: e.parameter.name,
        deviceId: e.parameter.deviceId
      });
      break;
    case 'register-owner':
      result = registerOwner({
        name: e.parameter.name,
        deviceId: e.parameter.deviceId
      });
      break;
    case 'reassign-owner':
      result = reassignOwner({
        name: e.parameter.name,
        deviceId: e.parameter.deviceId,
        resetCode: e.parameter.resetCode
      });
      break;
    default:
      result = processAttendance({
        name: e.parameter.name,
        action: e.parameter.action,
        lat: parseFloat(e.parameter.lat),
        lon: parseFloat(e.parameter.lon),
        deviceId: e.parameter.deviceId
      });
      break;
  }

  return ContentService.createTextOutput(callback + '(' + JSON.stringify({ result }) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function adminLogin(username, password) {
  const storedUser = PropertiesService.getScriptProperties().getProperty('adminUsername') || 'admin';
  const storedPassword = PropertiesService.getScriptProperties().getProperty('adminPassword') || 'lifecard2026';
  if (username && password && username === storedUser && password === storedPassword) {
    return { ok: true, message: 'Admin access granted.' };
  }
  return { ok: false, message: 'Invalid admin credentials.' };
}

function adminResetPassword(username, newPassword) {
  if (!username || !newPassword) {
    return { ok: false, message: 'Username and password are required.' };
  }
  PropertiesService.getScriptProperties().setProperty('adminUsername', username);
  PropertiesService.getScriptProperties().setProperty('adminPassword', newPassword);
  return { ok: true, message: 'Admin password updated.' };
}

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
  const resetCode = PropertiesService.getScriptProperties().getProperty('adminResetCode') || 'lifecard-reset-2026';
  if (payload.resetCode !== resetCode) {
    return { allowed: false, message: 'Invalid reset code.' };
  }
  saveStaffDeviceId(payload.name, payload.deviceId);
  return { allowed: true, message: 'Device reassigned.' };
}

function processAttendance(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs');
  const staffSheet = getOrCreateStaffSheet(ss);

  if (!logsSheet) {
    ss.insertSheet('Logs');
  }

  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = Utilities.formatDate(todayDate, 'GMT+1', 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, 'GMT+1', 'hh:mm a');
  const hour = now.getHours();

  const staffData = staffSheet.getDataRange().getValues();
  let staffRow = -1;

  const incomingParts = (payload.deviceId || '').split('-');
  const incomingHW = incomingParts[1] || '';
  const incomingSalt = incomingParts[2] || '';

  for (let i = 1; i < staffData.length; i++) {
    const regName = staffData[i][0].toString().trim();
    const regFullID = staffData[i][1].toString().trim();
    const regParts = regFullID.split('-');
    const regHW = regParts[1] || '';
    const regSalt = regParts[2] || '';
    const isCurrentStaff = regName.toLowerCase() === (payload.name || '').trim().toLowerCase();

    if (regFullID !== '') {
      if (isCurrentStaff) {
        staffRow = i + 1;
        if (incomingHW !== regHW && incomingSalt !== regSalt) {
          return 'BLOCK|Device mismatch. This account is locked to a different phone.';
        }
        if (regFullID !== payload.deviceId) {
          staffSheet.getRange(staffRow, 2).setValue(payload.deviceId);
        }
      } else {
        if (incomingHW === regHW || incomingSalt === regSalt) {
          return 'BLOCK|This device is already registered to ' + regName + '. Device sharing is not allowed.';
        }
      }
    } else if (isCurrentStaff) {
      staffRow = i + 1;
      staffSheet.getRange(staffRow, 2).setValue(payload.deviceId);
    }
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
    if (logs[j][1].toString().trim().toLowerCase() === (payload.name || '').trim().toLowerCase()) {
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
