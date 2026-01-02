import pool from "./config/db.js";

async function check() {
    try {
        const res = await pool.query(`
      SELECT column_name, character_maximum_length 
      FROM information_schema.columns 
      WHERE table_name = 'projects'
    `);
        res.rows.forEach(r => console.log(`${r.column_name}: ${r.character_maximum_length}`));
        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

check();
