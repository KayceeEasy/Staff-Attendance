const fs = require('fs');

const c = fs.readFileSync('admin/admin.js', 'utf8');
c.split('\n').forEach((l, idx) => {
    if (l.includes('get-week-data') || l.includes('get-attendance') || l.includes('list-attendance') || l.includes('loadWeekData')) {
        console.log(`${idx + 1}: ${l.trim().substring(0, 120)}`);
    }
});
