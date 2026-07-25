# Lifecard Staff Attendance PWA

A Progressive Web App (PWA) for staff attendance tracking featuring GPS geofencing, device locking, offline queueing with auto-sync, an admin console, and a responsive glassmorphism design system.

---

## 💡 Practical Technical Explanation: Device & Account Lock Checks

When auditing `Code.js` (Google Apps Script backend), you will find two complementary security checks:

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
   - Constant: `SCRIPT_URL`
   - Current value:
     ```javascript
     const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwKXksPAcj-dar7BkC_lAoGsVM-aF0BT81lkgToafv0natBxpb1S8iI0KD8q0NJemwksw/exec';
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
4. Copy the Web App URL and update `SCRIPT_URL` in `common.js`.

### Step 2: Deploy Frontend PWA
1. Upload all repository files to GitHub Pages, Netlify, Vercel, Cloud Run, or any HTTPS static web server:
   ```
   /
   ├── index.html
   ├── style.css
   ├── script.js
   ├── common.js
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
2. **HTTPS requirement**: PWA features (Service Worker and Geolocation API) require HTTPS.

---

## 🧪 Testing New Features & Verification

1. **Searchable Staff Name Dropdown**:
   - Open `index.html`.
   - Click or tap the "Search or select staff name..." input.
   - Type a name (e.g. "Deborah"). Verify that the dropdown filters instantly.
   - Verify staff names are sorted alphabetically (`A-Z`).
   - Click the clear button (`✕`) to clear selection.
   - Use Arrow keys (Up/Down) and Enter key to select via keyboard.

2. **Big Round Hero Sign In Button**:
   - Notice the large central circular button taking up ~40-50% of card width.
   - Verify the rotating dashed ring animation, hover glow, and press micro-interactions.
   - Once a staff name is selected and GPS is ready, tap **SIGN IN**.
   - Verify that **Sign Out** is conveniently located in a secondary pill button below.

3. **Dark/Light Mode Contrast**:
   - Click the "Dark / Light" theme button in the top right.
   - Open the staff dropdown in dark mode. Verify clear, legible text with zero white-on-white issues.
   - Check recent attendance log items and FAQ modal in both themes.

4. **Offline Queue & Sync**:
   - Disconnect Wi-Fi / Mobile Data or use Chrome DevTools Offline mode.
   - Perform a Sign In or Sign Out. Verify entry appears as "Pending sync".
   - Reconnect internet — verify entry auto-syncs with the server.

---

## 🔒 Security & Architecture

- **Web Crypto Hashing**: Passwords use SHA-256 client-side hashing before transmission.
- **Hardware & UUID Identity**: Device locking combines random UUID with hardware characteristics stored in IndexedDB.
- **CSRF Token Validation**: Secured server interactions with time-bound tokens.
- **Session Timeout**: Admin console automatically prompts after 5 minutes of inactivity.
