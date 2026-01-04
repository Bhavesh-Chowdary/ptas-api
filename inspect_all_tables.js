import pool from "./config/db.js";

async function check() {
    try {
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log("TABLES:");
        const tables = tablesRes.rows.map(r => r.table_name);
        console.log(tables);

        for (const table of tables) {
            const colsRes = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table]);
            console.log(`\nCOLUMNS FOR ${table}:`);
            colsRes.rows.forEach(r => console.log(`${r.column_name} (${r.data_type})`));
        }

        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

check();
