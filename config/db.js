const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'roomierush',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
});

console.log('Database pool created for host:', process.env.DB_HOST || 'localhost');

module.exports = pool;