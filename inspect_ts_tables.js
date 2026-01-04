import pool from "./config/db.js";

async function check() {
    try {
        const tables = ['users', 'projects', 'tasks', 'timesheets', 'weekly_timesheets', 'timesheet_entries'];
        for (const table of tables) {
            try {
                const res = await pool.query(`
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_name = $1
                `, [table]);
                console.log(`--- ${table} ---`);
                res.rows.forEach(r => console.log(`${r.column_name} (${r.data_type})`));
            } catch (e) {
                console.log(`--- ${table} (not found) ---`);
            }
        }
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
}

check();
