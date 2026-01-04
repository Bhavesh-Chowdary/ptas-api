import pool from "./config/db.js";

async function run() {
    try {
        console.log("Creating weekly_timesheets table...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS weekly_timesheets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                supervisor_id UUID REFERENCES users(id),
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                daily_data JSONB NOT NULL,
                total_hours DECIMAL(10,2) DEFAULT 0,
                approved_hours DECIMAL(10,2) DEFAULT 0,
                status VARCHAR(20) DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Success!");
        process.exit(0);
    } catch (err) {
        console.error("Error creating table:", err.message);
        console.log("Retrying with uuid_generate_v4()...");
        try {
            await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS weekly_timesheets (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    supervisor_id UUID REFERENCES users(id),
                    week_start DATE NOT NULL,
                    week_end DATE NOT NULL,
                    daily_data JSONB NOT NULL,
                    total_hours DECIMAL(10,2) DEFAULT 0,
                    approved_hours DECIMAL(10,2) DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'draft',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log("Success with uuid_generate_v4!");
            process.exit(0);
        } catch (err2) {
            console.error("Final Error:", err2.message);
            process.exit(1);
        }
    }
}

run();
