const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  try {
    const migrationPath = path.join(__dirname, 'migrations', '001_create_log_entries.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await pool.query(sql);
    console.log('Migration completed successfully');
  } catch (err) {
    console.log('Migration failed', err);
  } finally {
    await pool.end();
  }
}

migrate();
