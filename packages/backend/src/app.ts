import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { authFunctionRoutes } from './functions/auth.js';
import { tasksFunctionRoutes } from './functions/tasks.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'shared-todo-backend',
    timestamp: new Date().toISOString(),
  }));

  app.register(authFunctionRoutes, { prefix: '/api' });
  app.register(tasksFunctionRoutes, { prefix: '/api' });

  return app;
}
