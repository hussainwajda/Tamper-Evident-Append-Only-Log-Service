const { Pool } = require('pg');
const pino = require('pino');
require('dotenv').config();

// Use a module-level logger so database connection errors are structured.
const logger = pino();

// Configure the pool from DATABASE_URL so local and hosted Postgres use the same setting.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Log idle client errors without throwing, because pg can recover by replacing bad clients.
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

module.exports = pool;
