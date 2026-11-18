import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'boutique_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'atelier_boutique',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  decimalNumbers: true,
  multipleStatements: false,
});

export async function pingDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    await conn.query('SELECT 1 AS ok');
    return true;
  } finally {
    conn.release();
  }
}

export async function withTransaction(callback) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // Ignore rollback errors after failed connection/tx
    }
    throw err;
  } finally {
    conn.release();
  }
}

export default pool;
