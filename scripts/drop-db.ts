import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function dropAndRecreate() {
  try {
    console.log('Dropping all tables...');
    await pool.query('DROP SCHEMA public CASCADE;');
    await pool.query('CREATE SCHEMA public;');
    await pool.query('GRANT ALL ON SCHEMA public TO postgres;');
    await pool.query('GRANT ALL ON SCHEMA public TO public;');
    console.log('✅ Database dropped and ready for schema push');
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

dropAndRecreate();
