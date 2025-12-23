import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function dropAllTables() {
  try {
    console.log('Dropping all tables...');
    
    // Get all table names
    const result = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);
    
    const tables = result.rows.map(row => row.tablename);
    
    if (tables.length === 0) {
      console.log('No tables to drop');
      return;
    }
    
    console.log(`Found ${tables.length} tables to drop:`, tables.join(', '));
    
    // Drop all tables with CASCADE
    for (const table of tables) {
      await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
      console.log(`Dropped table: ${table}`);
    }
    
    console.log('✅ All tables dropped');
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

dropAllTables();
