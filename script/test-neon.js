import 'dotenv/config';
import NeonActivityStore from './neonActivityStore.js';
import { redactError } from './db-security.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL no está configurada.');
  process.exitCode = 1;
} else {
  let store;
  try {
    store = new NeonActivityStore();
    await store.initialize();
    await store.pool.query('SELECT 1');
    console.log('Conexión exitosa con Neon.');
  } catch (error) {
    console.error('Error al conectar con Neon:', redactError(error));
    process.exitCode = 1;
  } finally {
    if (store) {
      await store.close();
    }
  }
}
