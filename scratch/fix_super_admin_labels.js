const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../super-admin/index.html');
let html = fs.readFileSync(filePath, 'utf8');

const inputReplacements = [
    { from: 'id="master-key-input" placeholder="Enter Master Platform Key"', to: 'id="master-key-input" placeholder="Enter Master Platform Key" aria-label="Master Platform Key"' },
    { from: 'id="tenant-search-input"', to: 'id="tenant-search-input" aria-label="Search workspaces by name or slug"' },
    { from: '<label>Company Name</label>\n                                <input type="text" id="master-company-name"', to: '<label for="master-company-name">Company Name</label>\n                                <input type="text" id="master-company-name" aria-label="Company Name"' },
    { from: '<label>Workspace Identifier (URL)</label>\n                                <input type="text" id="master-company-slug"', to: '<label for="master-company-slug">Workspace Identifier (URL)</label>\n                                <input type="text" id="master-company-slug" aria-label="Workspace Identifier"' },
    { from: '<label>Primary Admin Contact Name</label>\n                                <input type="text" id="master-admin-name"', to: '<label for="master-admin-name">Primary Admin Contact Name</label>\n                                <input type="text" id="master-admin-name" aria-label="Primary Admin Contact Name"' },
    { from: '<label>Primary Admin Work Email</label>\n                                <input type="email" id="master-admin-email"', to: '<label for="master-admin-email">Primary Admin Work Email</label>\n                                <input type="email" id="master-admin-email" aria-label="Primary Admin Work Email"' },
    { from: '<input type="color" id="master-brand-color"', to: '<input type="color" id="master-brand-color" aria-label="Pick brand color"' },
    { from: '<input type="text" id="master-brand-color-text"', to: '<input type="text" id="master-brand-color-text" aria-label="Brand color hex value"' },
    { from: '<input type="text" id="master-logo-url"', to: '<input type="text" id="master-logo-url" aria-label="Company logo image URL"' },
    { from: '<label>Office / Branch Name</label>\n                                <input type="text" id="master-office-name"', to: '<label for="master-office-name">Office / Branch Name</label>\n                                <input type="text" id="master-office-name" aria-label="Office / Branch Name"' },
    { from: '<label>Office Latitude</label>\n                                <input type="number" step="any" id="master-latitude"', to: '<label for="master-latitude">Office Latitude</label>\n                                <input type="number" step="any" id="master-latitude" aria-label="Office Latitude"' },
    { from: '<label>Office Longitude</label>\n                                <input type="number" step="any" id="master-longitude"', to: '<label for="master-longitude">Office Longitude</label>\n                                <input type="number" step="any" id="master-longitude" aria-label="Office Longitude"' },
    { from: '<label>Geofence Radius (Meters)</label>\n                                <input type="number" id="master-radius"', to: '<label for="master-radius">Geofence Radius (Meters)</label>\n                                <input type="number" id="master-radius" aria-label="Geofence Radius in meters"' },
    { from: '<label>Grace Period (Minutes)</label>\n                                <input type="number" id="master-grace-period"', to: '<label for="master-grace-period">Grace Period (Minutes)</label>\n                                <input type="number" id="master-grace-period" aria-label="Grace Period in minutes"' },
    { from: '<input type="text" id="new-staff-name" placeholder="Full name"', to: '<input type="text" id="new-staff-name" placeholder="Full name" aria-label="Employee full name"' },
    { from: '<input type="text" id="new-staff-dept" placeholder="Dept"', to: '<input type="text" id="new-staff-dept" placeholder="Dept" aria-label="Department"' },
    { from: '<input type="checkbox" id="new-staff-is-lead"', to: '<input type="checkbox" id="new-staff-is-lead" aria-label="Team Lead flag"' },
    { from: '<input type="text" id="master-new-admin-pass" placeholder="Enter new password (min 6 chars)"', to: '<input type="text" id="master-new-admin-pass" placeholder="Enter new password (min 6 chars)" aria-label="New admin password"' },
    { from: '<input type="file" id="master-import-file" accept=".json"', to: '<input type="file" id="master-import-file" accept=".json" aria-label="Upload JSON backup archive"' },
    { from: '<input type="password" id="current-master-key-input"', to: '<input type="password" id="current-master-key-input" aria-label="Current Master Key"' },
    { from: '<input type="password" id="new-master-key-input"', to: '<input type="password" id="new-master-key-input" aria-label="New Master Key"' },
    { from: '<input type="password" id="confirm-master-key-input"', to: '<input type="password" id="confirm-master-key-input" aria-label="Confirm New Master Key"' }
];

inputReplacements.forEach(r => {
    if (html.includes(r.from)) {
        html = html.replace(r.from, r.to);
    } else {
        console.warn('Could not match target snippet:', r.from);
    }
});

fs.writeFileSync(filePath, html, 'utf8');
console.log('✅ Super admin accessibility labels updated!');
