import pool from "./config/db.js";

async function fix() {
    try {
        console.log("Increasing color length to 50...");
        await pool.query(`ALTER TABLE projects ALTER COLUMN color TYPE VARCHAR(50)`);

        console.log("Checking modules table...");
        await pool.query(`ALTER TABLE modules ALTER COLUMN module_code TYPE VARCHAR(100)`);
        await pool.query(`ALTER TABLE modules ALTER COLUMN name TYPE VARCHAR(255)`);

        console.log("DB fix 2 completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Error fixing DB:", err);
        process.exit(1);
    }
}

fix();
