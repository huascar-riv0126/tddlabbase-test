import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL no está configurada.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('tdd_branch', 'tdd_commit', 'tdd_merge', 'tdd_execution')
      ORDER BY table_name
    `);

    console.log('Conexión exitosa con Neon.');
    console.log('Tablas TDD disponibles:', result.rows.map((row) => row.table_name));
  } catch (error) {
    console.error('Error al conectar con Neon:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
