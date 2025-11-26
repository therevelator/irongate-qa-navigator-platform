const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function testConnection() {
  try {
    console.log('Connecting to database...');
    const connection = await mysql.createConnection(process.env.DATABASE_URL);
    
    console.log('✅ Connected successfully!');
    
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`\n📊 Found ${tables.length} tables:`);
    tables.forEach(table => {
      console.log(`  - ${Object.values(table)[0]}`);
    });
    
    await connection.end();
    console.log('\n✅ Connection test passed!');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
