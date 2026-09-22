# 🏢 Staff Attendance Cloud (v3.0.0)

> A modern, commercial multi-tenant employee attendance and hybrid work tracking platform with GPS geofencing, WebAuthn biometrics, and cryptographic device locking.

---

## 🌟 Overview

**Staff Attendance Cloud** is an enterprise-grade, privacy-first Progressive Web Application (PWA) designed for modern hybrid organizations. It enables businesses to manage employee check-ins across physical offices and remote locations with zero proxy-punching fraud, seamless offline recovery, and multi-tenant cloud isolation.

---

## 🚀 Key Features

### 🏢 Multi-Tenant SaaS Architecture
- **Instant Workspace Onboarding (`/onboard/`)**: 14-day free commercial trial, custom workspace slug (e.g. `/tenant/acme/`), and corporate work email verification via 6-digit OTP.
- **Strict Data Isolation**: Multi-tenant data partition across Supabase PostgreSQL databases with dedicated tenant schemas, isolated rosters, hybrid policies, and audit logs.
- **Super Admin Fleet Console (`/super-admin/`)**: High-level platform metrics, tenant directory, cryptographic session masquerade, and commercial subscription management (+14d / +30d trial extensions, promo coupons).

### 📍 Geolocation & Anti-Fraud Security
- **GPS Geofencing**: Strict distance radius verification ensuring staff can only check in when physically on-site at their company's office coordinates.
- **Cryptographic Device Locking**: Each staff account is securely bound to their physical device upon initial pairing, preventing "buddy-punching" or proxy attendance.
- **WebAuthn Biometric Verification**: Native support for **Face ID**, **Touch ID**, and **Windows Hello** for instantaneous 1-tap biometric confirmation.
- **Zero Directory Exposure**: Company staff directories are protected against scraping; pairing is conducted via one-time secure links (`?join=CODE`) or verified workspace codes.

### 📱 Staff Experience & Attendance Portal (`/`)
- **Fast Type-to-Search Roster**: Real-time filtering and selection of employee names with department chips and keyboard navigation.
- **Dynamic Hero Action Button**: Single focal action button that intelligently transitions between **`SIGN IN`**, **`SIGN OUT`**, **`COMPLETED`**, and **`ON LEAVE`**.
- **Contextual Status Indicators**:
  - 🏠 **Home / WFH**: Scheduled remote work day.
  - 📍 **Office**: In-person attendance required and verified.
  - 🌴 **Leave**: Approved leave or vacation.
- **Offline Sync & PWA**: Full offline capability with automatic background submission queue that syncs immediately when connectivity returns.

### 📊 Tenant Admin Console (`/admin/`)
- **Anytime Invite & QR Sharing**: Tenant admins can view, print, or share their workspace pairing code and dynamic QR code at any point.
- **Weekly Hybrid Schedule Matrix**: Visual schedule editor allowing leads to assign in-office, home, and leave days for the week.
- **Commercial Billing & Promo Codes**: Built-in promo redemption modal (`EXTEND14`, `VIP30`, `WELCOME50`) and churn-reduction retention workflows.
- **Data Export & Archiving**: One-click exports for CSV employee rosters, attendance history, printable summary sheets, and complete JSON backups.

### 📲 Native Mobile App (`mobile_app/`)
- **Expo / React Native App**: Native iOS & Android companion app.
- **Smart Background Geofencing**: Automatically detects arrival at the office and delivers sign-in alerts.
- **Weekend & Remote Suppression**: Background geofence alerts are strictly suppressed on Saturdays, Sundays, and non-office schedule days.

---

## 🛠️ Tech Stack

- **Frontend**: Pure modern Vanilla JavaScript (ES2022+), Semantic HTML5, CSS3 with dark mode and CSS custom properties, Lucide Icons.
- **Database & Backend**: [Supabase](https://supabase.com/) (PostgreSQL with Row Level Security, REST API, Auth).
- **Deployment**: Static Web Hosting ([Cloudflare Workers / Pages](https://pages.cloudflare.com/), [Vercel](https://vercel.com/), or [GitHub Pages](https://pages.github.com/)).
- **Mobile**: Expo / React Native (`mobile_app/`).

---

## 📂 Project Structure

```
├── admin/               # Tenant Admin Console (Staff directory, QR sharing, logs, billing)
├── super-admin/         # Super Admin Fleet Console (Multi-tenant oversight, masquerade)
├── onboard/             # Self-serve Tenant Onboarding with 14-day trial & OTP verification
├── hybrid/              # Hybrid work week scheduler matrix
├── mobile_app/          # Native React Native / Expo companion app
├── schema/              # Supabase PostgreSQL DDL migrations & RLS policies
├── scratch/             # Automated integration & localhost E2E test suites
├── build.js             # Automated production bundler for Cloudflare / static hosts
├── common.js            # Shared backend service layer, Supabase client, and crypto
├── index.html           # Main Staff Attendance Portal
├── script.js            # Staff portal controller, biometrics, and type-to-search dropdown
├── style.css            # Unified responsive stylesheets & dark mode themes
├── sandbox_server.js    # Local development server with clean URL rewrites
└── wrangler.jsonc       # Cloudflare Workers Static Assets configuration
```

---

## 💻 Local Development

### 1. Start the Local Sandbox Server
```bash
# Starts the local development server on port 8080
node sandbox_server.js
```
Then navigate to:
- **Staff Portal**: `http://localhost:8080/`
- **Tenant Admin**: `http://localhost:8080/admin/`
- **Super Admin**: `http://localhost:8080/super-admin/`
- **Onboarding**: `http://localhost:8080/onboard/`
- **Hybrid Scheduler**: `http://localhost:8080/hybrid/?key=admin`

### 2. Run Automated Verification Tests
```bash
# Full localhost end-to-end integration test suite
node scratch/verify_localhost_e2e.js

# UI hardening, emoji restoration, and multi-tenant isolation tests
node scratch/verify_ui_onboard_header_hardening.js

# Cryptographic masquerade and device binding tests
node scratch/verify_hardening_and_masquerade.js

# WebAuthn biometrics and clean URL tests
node scratch/verify_biometrics_and_clean_url.js
```

### 3. Build for Production / Cloudflare
```bash
npm run build
```
Creates an optimized, lightweight `./dist` folder (under 1.5 MB) ready for deployment to Cloudflare Pages or Vercel.

---

## 📄 License

Copyright &copy; 2026 Kaycee Tech. All Rights Reserved.
