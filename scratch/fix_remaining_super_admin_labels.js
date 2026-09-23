const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../super-admin/index.html');
let html = fs.readFileSync(filePath, 'utf8');

const reps = [
    {
        from: '<label>Primary Admin Email</label>\n                                <input type="email" id="master-admin-email" />',
        to: '<label for="master-admin-email">Primary Admin Email</label>\n                                <input type="email" id="master-admin-email" aria-label="Primary Admin Email" />'
    },
    {
        from: '<label>Branch / HQ Office Name</label>\n                            <input type="text" id="master-office-name" required />',
        to: '<label for="master-office-name">Branch / HQ Office Name</label>\n                            <input type="text" id="master-office-name" aria-label="Branch or HQ Office Name" required />'
    },
    {
        from: '<label>Latitude Coordinate</label>\n                                <input type="number" step="any" id="master-latitude" required />',
        to: '<label for="master-latitude">Latitude Coordinate</label>\n                                <input type="number" step="any" id="master-latitude" aria-label="Office Latitude Coordinate" required />'
    },
    {
        from: '<label>Longitude Coordinate</label>\n                                <input type="number" step="any" id="master-longitude" required />',
        to: '<label for="master-longitude">Longitude Coordinate</label>\n                                <input type="number" step="any" id="master-longitude" aria-label="Office Longitude Coordinate" required />'
    },
    {
        from: '<label>Geofence Radius (meters)</label>\n                                <input type="number" id="master-radius" min="10" max="5000" required />',
        to: '<label for="master-radius">Geofence Radius (meters)</label>\n                                <input type="number" id="master-radius" aria-label="Geofence Radius in meters" min="10" max="5000" required />'
    },
    {
        from: '<label>Morning Late Grace Period (minutes)</label>\n                                <input type="number" id="master-grace-period" min="0" max="120" value="15" required />',
        to: '<label for="master-grace-period">Morning Late Grace Period (minutes)</label>\n                                <input type="number" id="master-grace-period" aria-label="Morning Late Grace Period in minutes" min="0" max="120" value="15" required />'
    },
    {
        from: '<input type="text" id="new-staff-name" placeholder="Employee Full Name" />',
        to: '<input type="text" id="new-staff-name" placeholder="Employee Full Name" aria-label="Employee Full Name" />'
    },
    {
        from: '<input type="text" id="new-staff-dept" placeholder="Department (e.g. Sales, IT)" />',
        to: '<input type="text" id="new-staff-dept" placeholder="Department (e.g. Sales, IT)" aria-label="Department (e.g. Sales, IT)" />'
    },
    {
        from: '<input type="text" id="master-new-admin-pass" placeholder="Enter new temporary password" style="max-width:320px;" />',
        to: '<input type="text" id="master-new-admin-pass" placeholder="Enter new temporary password" aria-label="Enter new temporary password" style="max-width:320px;" />'
    },
    {
        from: '<input type="file" id="master-import-file" accept=".json,application/json" style="font-size:0.84rem;" />',
        to: '<input type="file" id="master-import-file" accept=".json,application/json" aria-label="Upload JSON workspace backup file" style="font-size:0.84rem;" />'
    }
];

reps.forEach((r, idx) => {
    if (html.includes(r.from)) {
        html = html.replace(r.from, r.to);
    } else {
        console.warn(`Rep ${idx} not found`);
    }
});

fs.writeFileSync(filePath, html, 'utf8');
console.log('✅ Remaining super admin labels fixed!');
