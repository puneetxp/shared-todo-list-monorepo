import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';
import { initializeDatabase } from './db.js';

const app = buildApp();
let dbInitialized = false;

const proxy = awsLambdaFastify(app);

export const handler = async (event: unknown, context: unknown) => {
  if (!dbInitialized) {
    await initializeDatabase();
    dbInitialized = true;
  }
  return proxy(event as never, context as never);
};
