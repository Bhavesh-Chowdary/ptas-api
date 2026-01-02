import pool from "./config/db.js";

async function fix() {
    try {
        console.log("Checking project_code length...");
        const res = await pool.query(`
      SELECT column_name, character_maximum_length 
      FROM information_schema.columns 
      WHERE table_name = 'projects' AND column_name = 'project_code'
    `);
        console.log("Current status:", res.rows[0]);

        console.log("Increasing project_code length to 100...");
        await pool.query(`ALTER TABLE projects ALTER COLUMN project_code TYPE VARCHAR(100)`);

        console.log("Increasing status length to 50...");
        await pool.query(`ALTER TABLE projects ALTER COLUMN status TYPE VARCHAR(50)`);

        console.log("DB fix completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Error fixing DB:", err);
        process.exit(1);
    }
}

fix();
