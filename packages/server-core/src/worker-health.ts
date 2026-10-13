import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
  statement_timeout: 3000,
});
try {
  const result = await pool.query(
    "SELECT 1 FROM sb_worker_heartbeats WHERE updated_at>now()-interval '30 seconds' LIMIT 1",
  );
  if (!result.rowCount) process.exitCode = 1;
} finally {
  await pool.end();
}
