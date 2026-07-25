# 📍 Lifecard Staff Attendance PWA

> A modern, location-verified Progressive Web App (PWA) designed for seamless employee attendance tracking, hardware device locking, offline synchronization, and administrative workforce management.

---

## 📋 Project Overview (Simple, Brief & Detailed)

The **Lifecard Staff Attendance Portal** is a full-stack, mobile-first web application that automates daily employee attendance with strict location and device verification.

### 🌟 Key Features
- **📍 GPS Geofenced Verification**: Staff can only sign in or out when physically present within the designated office radius (e.g., 50 meters). Location coordinates are validated server-side.
- **🔒 1:1 Hardware Device Locking**: Prevents "buddy punching" (signing in for a colleague). Each staff account is permanently locked to one physical device using canvas hardware fingerprinting and IndexedDB UUIDs.
- **⚡ Offline-First PWA**: Works offline as an installable PWA. If internet connectivity drops, attendance entries are queued locally and automatically sync when connection returns.
- **📅 Hybrid Work Schedule Matrix**: Automatically syncs with Google Sheets to distinguish office days from Work-From-Home (WFH) days, displaying color-coded status cells:
  - 🟩 **Signed In** (On-time office check-in)
  - 🟨 **Late** (Check-in past company cutoff time)
  - 🟦 **Home** (Scheduled WFH day)
  - 🟥 **Absent** (No check-in on scheduled office day)
- **⚙️ Admin Management Portal**: Enables administrators to review real-time attendance logs, manage staff rosters, reset device locks, adjust GPS geofence radiuses, inspect distance alert violations, and export analytics/CSV reports.

---

## 🛠️ Tech Stack & Architecture

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, Glassmorphism CSS design system with auto dark/light theme switching, Service Worker caching.
- **Backend & Database**: Google Apps Script (`Code.gs`) coupled with Google Sheets as a lightweight cloud database.
- **Optional Express Proxy (`server.js`)**: Node.js proxy server enforcing Helmet security headers, CORS, CSRF token validation, and rate limiting.

---

## 💡 Practical Technical Explanation: Device & Account Lock Checks

When auditing `Code.gs` (Google Apps Script backend), you will find two complementary security checks:

1. **`if (status.conflictOwner) return 'This device is already registered to ' + status.conflictOwner + '. Device sharing is not allowed.';`**
   - **Focus**: **Device-Centric Constraint** (Prevents Device Sharing / Buddy Punching).
   - **Scenario**: Physical phone `Device-123` is registered to **Staff A**. **Staff B** tries to sign in using `Device-123`.
   - **What it does**: Blocks the attempt because the physical phone belongs to someone else. Multiple staff members cannot share the same phone to check in.

2. **`if (status.currentStoredDeviceId && status.currentStoredDeviceId !== cleanDeviceId) { return 'Device mismatch. This account is locked to a different phone.';}`**
   - **Focus**: **Account-Centric Constraint** (Prevents Account Hijacking / Multi-Device Switching).
   - **Scenario**: **Staff A**'s account is locked to `Device-123`. **Staff A** gets hold of `Device-999` and attempts to sign in.
   - **What it does**: Blocks the attempt because **Staff A** is trying to sign in from an unregistered phone. An account locked to Device X cannot sign in from Device Y without an admin resetting the device lock.

**Summary**:
- Check #1 ensures **one phone cannot be shared by multiple users**.
- Check #2 ensures **one user account cannot hop across multiple phones**.
Together, they enforce a strict 1:1 bi-directional binding between a Staff Member and their registered Physical Device.

---

## 🛠️ Placeholders to Replace Before Production

Before deploying to production, make sure to inspect and customize the following configuration placeholders:

1. **Google Apps Script URL (`common.js`)**:
   - File: `/common.js`
   - Constant: `FALLBACK_GAS_URL`
   - Current value:
     ```javascript
     const FALLBACK_GAS_URL = 'https://script.google.com/macros/s/AKfycbwKXksPAcj-dar7BkC_lAoGsVM-aF0BT81lkgToafv0natBxpb1S8iI0KD8q0NJemwksw/exec';
     ```
   - Update this URL if you re-deploy or change your Google Apps Script web app version.

2. **Spreadsheet ID for Hybrid Schedule (`HS.js`)**:
   - File: `/HS.js`
   - Constant: `HYBRID_SCHEDULE_SHEET_ID`
   - Replace `'1Mj-Pds8Kc4Rm_yh_EUafo3T-FEL7wurUco-u9l38lNk'` with your Google Sheet ID.

3. **Apps Script Credentials & Setup**:
   - Open your Apps Script editor (Extensions → Apps Script in Google Sheets).
   - Run the initial setup functions ONCE:
     ```javascript
     setDeveloperPasswordOnce();  // Sets master developer password
     addAdminAccountOnce();       // Creates first admin account
     setDeviceResetCodeOnce();    // Sets reset code for device reassignment
     ```

---

## 🚀 Step-by-Step Deployment Guide

### Step 1: Deploy Backend (Google Apps Script)
1. Create a Google Sheet with 3 tabs: `Staff`, `Logs`, and `Distance Alerts`.
2. Open **Extensions → Apps Script**, paste `Code.gs` (or `apps-script.js`).
3. Click **Deploy → New Deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the Web App URL and update `FALLBACK_GAS_URL` in `common.js`.

### Step 2: Deploy Frontend PWA
1. Upload all repository files to GitHub Pages, Netlify, Vercel, Cloud Run, or any HTTPS static web server:
   ```
   /
   ├── index.html
   ├── style.css
   ├── script.js
   ├── common.js
   ├── version.js
   ├── sw.js
   ├── manifest.json
   ├── README.md
   ├── CHANGELOG.md
   ├── HS.js
   ├── image/
   │   └── png/
   │       ├── icon-192.png
   │       └── icon-512.png
   └── admin/
       ├── index.html
       └── admin.js
   ```
2. **HTTPS Requirement**: PWA features (Service Worker and Geolocation API) require HTTPS.

---

## 🧪 Testing Features & Verification

1. **Searchable Staff Name Dropdown**:
   - Open `index.html`.
   - Click or tap the "Search or select staff name..." input.
   - Type a name (e.g., "Deborah"). Verify that the dropdown filters instantly.
   - Verify staff names are sorted alphabetically (`A-Z`).
   - Click the clear button (`✕`) to clear selection.

2. **Hero Sign In Button**:
   - Tap **SIGN IN** after selecting a staff member when GPS is ready.
   - Verify that **Sign Out** is available in the secondary button below.

3. **Dark/Light Mode Contrast**:
   - Click the "Dark / Light" theme button in the top right to toggle modes.
   - Open the staff dropdown in dark mode to verify high contrast and legibility.

4. **Offline Queue & Sync**:
   - Disconnect Wi-Fi / Mobile Data or use Chrome DevTools Offline mode.
   - Perform a Sign In or Sign Out. Verify entry appears as "Pending".
   - Reconnect internet — verify entry auto-syncs with the server.

---

## 🔒 Security & Architecture

- **Web Crypto Hashing**: Passwords use SHA-256 client-side hashing before transmission.
- **Hardware & UUID Identity**: Device locking combines random UUID with hardware characteristics stored in IndexedDB.
- **CSRF Token Validation**: Secured server interactions with time-bound tokens.
- **Session Timeout**: Admin console automatically prompts after 5 minutes of inactivity.
