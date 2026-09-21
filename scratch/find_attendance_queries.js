const fs = require('fs');

function find(filename, term) {
    const c = fs.readFileSync(filename, 'utf8');
    c.split('\n').forEach((l, idx) => {
        if (l.toLowerCase().includes(term.toLowerCase())) {
            console.log(`${filename}:${idx + 1}: ${l.trim().substring(0, 120)}`);
        }
    });
}

console.log('--- Queries to attendance table in common.js ---');
find('common.js', "from('attendance')");

console.log('--- Queries to attendance table in admin/admin.js ---');
find('admin/admin.js', "from('attendance')");
