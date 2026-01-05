import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Avoid crashing the process on unexpected connection termination
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;
