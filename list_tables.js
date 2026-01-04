import pool from "./config/db.js";

async function check() {
    try {
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        for (const t of tables) {
            console.log("TABLE_NAME_START:" + t + ":TABLE_NAME_END");
        }
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
}

check();
