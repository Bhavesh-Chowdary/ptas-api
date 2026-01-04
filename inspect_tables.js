import pool from "./config/db.js";

async function check() {
    try {
        const res = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
        console.log("USERS COLUMNS:");
        res.rows.forEach(r => console.log(r.column_name));

        const res2 = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'projects'
        `);
        console.log("\nPROJECTS COLUMNS:");
        res2.rows.forEach(r => console.log(r.column_name));

        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

check();
