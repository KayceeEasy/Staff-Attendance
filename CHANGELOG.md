# CHANGELOG — Staff Attendance PWA

All notable changes, bug fixes, visual upgrades, and structural audit enhancements for the **Staff Attendance PWA** are documented in this file.

---

## [v2.0.0] - 2026-07-24

### 🚀 Major Visual & Functional Upgrades
- **Searchable Staff Name Dropdown**:
  - Replaced raw scrolling `<select>` with a searchable, accessible staff combobox component (`.staff-search-wrapper`).
  - Added real-time name filtering as users type.
  - Included a clear button (`✕`) to quickly reset selection and search query.
  - Supported full keyboard navigation (Up/Down arrow keys, Enter to select, Escape to close).
  - Automatically syncs with the underlying select element and `saved_name` in `localStorage`.
- **Alphabetical Staff Name Sorting**:
  - Enforced `A-Z` alphabetical sorting across hardcoded HTML fallbacks, local cache (`attendance_staff_cache`), and live server responses (`list-staff`).
- **Big Round Hero Sign In Button**:
  - Redesigned the main screen focal point to center around a prominent, circular **Sign In** hero button (`.btn-in-hero`).
  - Scales responsively to take up ~40–50% of card/screen width (`clamp(150px, 48%, 200px)`).
  - Added subtle rotating ring animation (`::before`), glowing radial shadows, touch scale micro-interactions (`scale(1.05)` on hover, `scale(0.96)` on tap), and embedded Lucide `log-in` icon.
  - Positioned **Sign Out** cleanly below in a secondary pill-shaped zone (`.btn-out-secondary`), keeping Sign In as the primary visual focus.

---

### 🎨 Color Palette & Contrast Fixes
- **Dark Mode Contrast Improvements**:
  - Enforced explicit `background-color: #0f1c37; color: #f1f5f9;` for standard `<option>` elements to prevent white text on white backgrounds on mobile OS select pickers.
  - Upgraded dropdown menu list background (`.staff-options-list`) with backdrop blur and border contrast (`border-color: var(--border-strong)`).
  - Enhanced text readability for `#log-list li`, `.admin-row`, `.logs-row`, `.attendance-matrix`, `.status-pill`, and `.dialog-box` across both Light and Dark themes.

---

### 🛠️ Syntax Fixes & Code Audit
- **Service Worker (`sw.js`) Syntax Fix**:
  - Fixed invalid line 1 statement `'staff-attendance-v9' CACHE_NAME = 'staff-attendance-v10';` -> corrected to `const CACHE_NAME = 'staff-attendance-v11';`.
- **Google Apps Script URL Update**:
  - Updated `SCRIPT_URL` in `common.js` to point to the new deployment:
    `https://script.google.com/macros/s/AKfycbwKXksPAcj-dar7BkC_lAoGsVM-aF0BT81lkgToafv0natBxpb1S8iI0KD8q0NJemwksw/exec`
- **FAQ Layout Cleanup (`style.css`)**:
  - Fixed duplicate/conflicting `left: 2rem` and `left: 85%` CSS properties on `.faq-search-icon`.

---

### 🔒 Google Apps Script Backend Audit (`Code.gs`)
- **Constant-Time Hash Comparison**: Added `constantTimeCompare()` to prevent timing side-channel attacks on admin passwords and reset tokens.
- **Brute-Force Rate Limiting**: Implemented `checkRateLimit()` using `CacheService` for admin login and password recovery (locks after 5 failed attempts for 15 minutes).
- **Server-Side Input Sanitization**: Added `sanitizeInput()` across all backend endpoints to strip HTML/script tags and enforce string length limits.
- **Location Coordinate Validation**: Added explicit range checks (-90 to +90 for lat, -180 to +180 for lon) to prevent malformed or invalid GPS payloads.

---

### 🧠 Logic Clarification
- **Device Lock Logic Audited**:
  - Clarified the practical difference between `status.conflictOwner` (device-centric sharing check) and `status.currentStoredDeviceId` (account-centric locking check) in `README.md`.
