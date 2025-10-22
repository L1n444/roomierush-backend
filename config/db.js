const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'roomierush',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

// Add SSL configuration for production (Railway)
if (process.env.NODE_ENV === 'production') {
  dbConfig.ssl = {
    rejectUnauthorized: false
  };
}

console.log('🔧 Database Configuration:');
console.log(`   Host: ${dbConfig.host}`);
console.log(`   Database: ${dbConfig.database}`);
console.log(`   Port: ${dbConfig.port}`);
console.log(`   SSL: ${dbConfig.ssl ? 'Enabled' : 'Disabled'}`);

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection on startup
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully');
    
    // Test query
    await connection.query('SELECT 1');
    console.log('✅ Database query test passed');
    
    connection.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('Connection details:', {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user
    });
    
    // Don't exit in production, let Railway restart
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }
})();

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

module.exports = pool;