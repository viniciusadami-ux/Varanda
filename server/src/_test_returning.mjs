// Minimal sqlite3 sanity check
import sqlite3 from 'sqlite3';
const db = new sqlite3.Database(':memory:');
db.serialize(() => {
  db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
  db.run('INSERT INTO t (val) VALUES (?) RETURNING id', ['hello'], function (err, row) {
    if (err) {
      console.log('[run+RETURNING] FAIL:', err.message);
    } else {
      console.log('[run+RETURNING] OK, this.lastID:', this.lastID, 'row:', row);
    }
    db.get('SELECT * FROM t', (e, rows) => {
      console.log('[SELECT] rows:', rows);
      db.close();
    });
  });
});
setTimeout(() => process.exit(0), 2000);