const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:             process.env.DB_HOST     || 'localhost',
  port:             parseInt(process.env.DB_PORT) || 3306,
  database:         process.env.DB_NAME     || 'duolol',
  user:             process.env.DB_USER     || 'root',
  password:         process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit:  10,
  charset:          'utf8mb4',
  timezone:         '-03:00',
  ssl:              process.env.DB_HOST !== 'localhost' ? { rejectUnauthorized: false } : undefined
});

pool.getConnection()
  .then(c => { console.log('✅ MySQL conectado em', process.env.DB_HOST); c.release(); })
  .catch(e => console.error('❌ Erro MySQL:', e.message));

module.exports = pool;
