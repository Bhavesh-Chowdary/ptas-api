import pool from "./config/db.js";

async function check() {
    try {
        const res = await pool.query(`SELECT full_name, resource_serial FROM users WHERE resource_serial IS NOT NULL LIMIT 5`);
        console.log("USERS:");
        console.log(JSON.stringify(res.rows, null, 2));

        const res2 = await pool.query(`SELECT name, project_code, version FROM projects LIMIT 5`);
        console.log("\nPROJECTS:");
        console.log(JSON.stringify(res2.rows, null, 2));

        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

check();
