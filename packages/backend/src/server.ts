import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { initializeDatabase } from './db.js';

dotenv.config();

const PORT = 3000;
const HOST = '0.0.0.0';

async function start() {
  const app = buildApp();
  try {
    await initializeDatabase();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Backend server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
