/**
 * GOOGLE APPS SCRIPT FOR HYBRID SCHEDULE
 * Handles automatic saving and history retrieval.
 * Exports as HS.js for local editing before deploying to Apps Script.
 */

// Must match AppsScript.js's HYBRID_SCHEDULE_SHEET_ID — this is the same
// spreadsheet the Staff Attendance admin dashboard reads schedules from.
//
// IMPORTANT: use SpreadsheetApp.openById(...) here rather than
// SpreadsheetApp.getActiveSpreadsheet(). getActiveSpreadsheet() only
// resolves correctly when this script is container-bound (opened via
// Extensions > Apps Script from directly inside the target sheet). If this
// project is deployed standalone — which "exported for local editing
// before deploying" strongly suggests — getActiveSpreadsheet() returns
// null, and every save/load silently throws before it ever touches the
// sheet. Using an explicit ID works correctly either way, so this is a
// safe fix regardless of how the project is actually deployed.
const HYBRID_SCHEDULE_SHEET_ID = '1Mj-Pds8Kc4Rm_yh_EUafo3T-FEL7wurUco-u9l38lNk';

function getScheduleSpreadsheet() {
  return SpreadsheetApp.openById(HYBRID_SCHEDULE_SHEET_ID);
}

// Helper: parse a weekKey into a Date object representing Monday.
//
// IMPORTANT: ISO (yyyy-MM-dd) and dd/MM/yyyy are checked explicitly BEFORE
// falling back to the generic Date constructor. `new Date('05/06/2026')`
// silently parses that as US-style MM/DD/YYYY (=May 6) instead of the
// intended dd/MM/yyyy (=June 5) whenever the day-of-month is <= 12 — it
// doesn't throw, so a naive "try new Date() first" approach never reaches
// the correct branch below it for those dates. Same root-cause bug as in
// AppsScript.js's parseScheduleWeekKey; fixed here for consistency so this
// script's own week-label history view doesn't hit it either.
function parseDateFromKey(weekKey) {
  if (!weekKey) return null;
  if (weekKey instanceof Date) return weekKey;
  var str = String(weekKey).trim();
  if (!str) return null;

  // Try ISO YYYY-MM-DD first, parsing components directly (avoids any
  // UTC/local timezone shift from handing the raw string to `new Date()`).
  var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    var isoDate = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    if (!isNaN(isoDate.getTime())) return isoDate;
  }

  // Try dd/MM/yyyy
  var parts = str.split('/');
  if (parts.length === 3) {
    var day = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10) - 1;
    var year = parseInt(parts[2], 10);
    var d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // Last resort: generic Date parsing for anything else.
  var generic = new Date(str);
  if (!isNaN(generic.getTime())) return generic;

  return null;
}

// Helper: format week label like "June 29 - July 3, 2026"
function formatWeekLabel(mondayDate, tz) {
  if (!mondayDate) return '';
  tz = tz || 'GMT+1';
  var monday = new Date(mondayDate);
  var friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  var m1 = Utilities.formatDate(monday, tz, 'MMMM d');
  var m2 = Utilities.formatDate(friday, tz, 'MMMM d');
  var y1 = Utilities.formatDate(monday, tz, 'yyyy');
  var y2 = Utilities.formatDate(friday, tz, 'yyyy');

  if (y1 !== y2) {
    return m1 + ', ' + y1 + ' - ' + m2 + ', ' + y2;
  }
  return m1 + ' - ' + m2 + ', ' + y1;
}

// 1. Handles SAVING data (POST request)
function doPost(e) {
  var ss = getScheduleSpreadsheet();
  var sheet = ss.getSheets()[0]; // Uses the first tab
  var payload;
  try {
    if (e && e.postData && e.postData.contents) payload = JSON.parse(e.postData.contents);
    else payload = {};
  } catch (err) {
    payload = {};
  }

  var weekKey = payload.weekKey;
  var timestamp = payload.timestamp || new Date().toISOString();
  var scheduleData = '';
  try { scheduleData = JSON.stringify(payload.data); } catch (e2) { scheduleData = String(payload.data || ''); }

  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;

  // Check if this week already exists in the sheet to update it
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === weekKey) {
      rowIndex = i + 1; // Rows are 1-indexed
      break;
    }
  }

  if (rowIndex > -1) {
    // Update existing week (columns: 1=weekKey,2=timestamp,3=json)
    sheet.getRange(rowIndex, 2).setValue(timestamp);
    sheet.getRange(rowIndex, 3).setValue(scheduleData);
  } else {
    // Append new week
    sheet.appendRow([weekKey, timestamp, scheduleData]);
  }

  return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
}

// 2. Handles LOADING history (GET request)
function doGet(e) {
  var ss = getScheduleSpreadsheet();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var history = [];

  // We take the last 8 entries for the history list
  var startRow = Math.max(0, data.length - 8);

  for (var i = startRow; i < data.length; i++) {
    try {
      if (data[i][0] && data[i][2]) {
        var wk = data[i][0];
        var ts = data[i][1];
        var parsed = null;
        try { parsed = JSON.parse(data[i][2]); } catch (err) { parsed = data[i][2]; }

        // Compute human-friendly weekLabel based on weekKey when possible
        var mondayDate = parseDateFromKey(wk);
        var weekLabel = '';
        if (mondayDate) weekLabel = formatWeekLabel(mondayDate, 'GMT+1');

        history.push({
          weekKey: wk,
          timestamp: ts,
          weekLabel: weekLabel,
          data: parsed
        });
      }
    } catch (rowErr) {
      // skip malformed rows
    }
  }

  // Reverse so the newest is at the top
  return ContentService.createTextOutput(JSON.stringify(history.reverse()))
    .setMimeType(ContentService.MimeType.JSON);
}
