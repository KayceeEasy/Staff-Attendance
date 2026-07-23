# Lifecard Staff Attendance PWA

A Progressive Web App for staff attendance tracking with GPS geofencing, device locking, and offline support.

## Features

- **GPS Geofencing**: Staff can only sign in/out within 200m of office location
- **Device Locking**: One device per staff member to prevent sharing
- **Offline Support**: Attendance queues locally and auto-syncs when online
- **Admin Console**: Multi-admin support with staff management and logs viewer
- **PWA Features**: Installable, works offline, dark/light theme
- **Security**: SHA-256 password hashing, CSRF protection, device ownership verification

## Architecture

### Frontend
- Vanilla JavaScript PWA with service worker caching
- Responsive design with dark/light theme support
- Offline-first with automatic sync

### Backend
- Google Apps Script (serverless)
- Google Sheets as database (3 sheets: Staff, Logs, Distance Alerts)
- JSONP fallback for CORS compatibility

### Data Flow
1. Staff selects name → GPS verifies location → Device authorization check → Submit attendance
2. If offline: Queue locally → Auto-sync when connection returns
3. Server validates: Device lock, geofence, duplicate check, business rules

## Setup Instructions

### 1. Deploy Google Apps Script

1. Create a new Google Sheet with 3 tabs:
   - **Staff**: Columns A (Name), B (Device ID)
   - **Logs**: Columns A (Date), B (Name), C (Action), D (Time), E (Status), F (Distance)
   - **Distance Alerts**: Columns A (Date), B (Time), C (Name), D (Action), E (Distance), F (Lat), G (Lon)

2. Open Apps Script editor (Extensions → Apps Script)

3. Copy contents of `apps-script.js` into `Code.gs`

4. Deploy as web app:
   - Execute as: Me
   - Who has access: Anyone (for JSONP fallback)
   - Copy the deployment URL

5. Update `SCRIPT_URL` in `common.js` with your deployment URL

6. Run initial setup functions in Apps Script editor:
   ```javascript
   // Set developer password (change the password first!)
   setDeveloperPasswordOnce();
   
   // Create first admin account
   addAdminAccountOnce();
   
   // Set device reset code (change the code first!)
   setDeviceResetCodeOnce();
   ```

### 2. Configure Office Location

Default configuration (can be changed via admin panel):
- **Office Lat**: Set yours
- **Office Lon**: Set yours
- **Radius**: Set yours
- **Timezone**: Set yours

To update via admin panel:
1. Log into admin console
2. Use "System Configuration" section
3. Or set via Apps Script Properties:
   ```javascript
   PropertiesService.getScriptProperties().setProperty('OFFICE_LAT', '6.4518631');
   PropertiesService.getScriptProperties().setProperty('OFFICE_LON', '3.5277863');
   PropertiesService.getScriptProperties().setProperty('RADIUS_METERS', '200');
   PropertiesService.getScriptProperties().setProperty('TIMEZONE', 'GMT+1');
   ```

### 3. Deploy Frontend

1. Upload all files to your web server or hosting service
2. Ensure files are in the same directory structure:
   ```
   /
   ├── index.html
   ├── manifest.json
   ├── sw.js
   ├── script.js
   ├── common.js
   ├── style.css
   ├── favicon.ico
   ├── image/
   │   └── png/
   │       ├── icon-192.png
   │       └── icon-512.png
   └── admin/
       ├── index.html
       └── admin.js
   ```

3. Access via HTTPS (required for service worker and geolocation)

## Usage

### Staff Attendance

1. Open the app in mobile browser
2. Allow location access when prompted
3. Select your name from dropdown
4. Tap "Sign In" or "Sign Out"
5. App verifies GPS location and device authorization

### Admin Console

1. Navigate to `/admin/`
2. Log in with admin credentials
3. Available actions:
   - **Staff Management**: Add/remove staff, reset device locks
   - **Logs Viewer**: View/filter attendance records
   - **Device Reassignment**: Reassign devices with reset code
   - **Account Management**: Change password, set recovery email
   - **System Configuration**: Update office location, radius, timezone

## Business Rules

- **Sign In**:
  - Before 9:00 AM: "WELCOME" status
  - After 9:00 AM: "LATE" status
  - Auto sign-out if forgot previous day
  - Only once per day

- **Sign Out**:
  - Before 5:00 PM: "LATE" status (early leave warning)
  - After 5:00 PM: "NORMAL" status
  - Cannot sign out without signing in first
  - Only once per day

- **Geofence**: Must be within configured radius of office
- **Device Lock**: Each staff member can only use one registered device

## Security Features

- **Password Hashing**: SHA-256, never stored or transmitted in plaintext
- **CSRF Protection**: Token-based validation on all POST requests
- **Device Ownership**: Server-validated device locking
- **Session Management**: 1-hour admin sessions
- **Email Recovery**: Secure password reset via emailed codes
- **Developer Fallback**: Emergency admin account that can't be locked out

## Offline Behavior

- App works fully offline for signing in/out
- Submissions queue in localStorage (max 10 items)
- Auto-syncs when connection returns
- Exponential backoff retry: 8s → 16s → 32s → max 60s
- Visual indicators for pending/synced/offline status

## PWA Installation

1. Open app in supported browser (Chrome, Edge, Safari)
2. Tap "Install App" button when prompted
3. App installs to home screen
4. Works like native app with full-screen mode

## Troubleshooting

### "GPS REQUIRED" Error
- Enable location services in browser settings
- Allow location access for the site
- Use HTTPS (required for geolocation API)

### "Device Locked to Another Staff"
- Admin must reset device lock in admin panel
- Or use device reassignment with reset code

### "Already Signed In Today"
- Each staff can only sign in once per day
- Contact admin if this is an error

### Sync Not Working
- Check internet connection
- App retries automatically with exponential backoff
- Check browser console for errors
- Use Refresh button to clear service worker cache

## Development

### File Structure
- `index.html` - Main attendance page
- `admin/index.html` - Admin console
- `script.js` - Main page logic
- `admin/admin.js` - Admin panel logic
- `common.js` - Shared utilities (API, storage, crypto)
- `apps-script.js` - Backend Apps Script code
- `sw.js` - Service worker for PWA
- `style.css` - Styles (both pages)

### Key Technologies
- Vanilla JavaScript (no frameworks)
- Google Apps Script backend
- Google Sheets database
- Service Worker for offline caching
- Web Crypto API for hashing
- Geolocation API for GPS

### Browser Support
- Chrome/Edge 90+
- Safari 14+
- Firefox 88+
- Requires HTTPS for full functionality

## Configuration Options

### Apps Script Properties
- `OFFICE_LAT` - Office latitude coordinate
- `OFFICE_LON` - Office longitude coordinate
- `RADIUS_METERS` - Allowed distance from office (10-5000m)
- `TIMEZONE` - Timezone for date/time (e.g., GMT+1, GMT-5)
- `adminAccounts` - JSON object of admin accounts
- `developerPasswordHash` - Developer fallback account hash
- `adminResetCodeHash` - Hash of device reset code

### Client-Side Storage
- `attendance_pending_queue` - Offline submissions queue
- `attendance_recent_log` - Recent attendance history
- `attendance_last_action` - Last action for duplicate prevention
- `attendance_staff_cache` - Cached staff list
- `attendance_device_lock` - Local device lock hint
- `attendance_analytics` - Error/issue tracking
- `attendance_salt` - Device ID generation salt
- `saved_name` - Remembered staff name

## Maintenance

### Regular Tasks
- Review Distance Alerts sheet for suspicious activity
- Monitor Logs sheet for attendance patterns
- Check analytics for errors/issues
- Update staff list as needed

### Security
- Change default passwords immediately
- Set recovery email for all admin accounts
- Keep reset code secure (admin-only)
- Review device assignments periodically

## License

Proprietary - Lifecard Organization

## Support

For issues or questions, contact the developer or check:
- Browser console for client-side errors
- Apps Script editor logs for backend errors
- Distance Alerts sheet for GPS issues