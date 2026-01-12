import knex from 'knex';
import dotenv from 'dotenv';
dotenv.config();

const knexConfig = {
    client: 'pg',
    connection: {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    },
    pool: {
        min: 2,
        max: 10,
        acquireTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
    },
    acquireConnectionTimeout: 10000,
    debug: process.env.NODE_ENV === 'development',
};

const db = knex(knexConfig);

// Test connection
db.raw('SELECT 1')
    .then(() => {
        console.log('✓ Knex database connection established');
    })
    .catch((err) => {
        console.error('✗ Knex database connection failed:', err.message);
    });

export default db;
