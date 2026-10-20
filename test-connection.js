import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

async function testConnection() {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('sslmode');
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: isLocal ? undefined : { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to database...');
    await client.connect();

    console.log('✅ Connected successfully!');

    const { rows: tables } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log(`\n📊 Found ${tables.length} tables:`);
    tables.forEach(table => {
      console.log(`  - ${table.table_name}`);
    });

    await client.end();
    console.log('\n✅ Connection test passed!');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
