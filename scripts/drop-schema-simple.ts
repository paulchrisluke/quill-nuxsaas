import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function dropSchema() {
  try {
    console.log('Dropping public schema...');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE;');
    await pool.query('CREATE SCHEMA public;');
    await pool.query('GRANT ALL ON SCHEMA public TO postgres;');
    await pool.query('GRANT ALL ON SCHEMA public TO public;');
    console.log('✅ Schema dropped and recreated');
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

dropSchema();
