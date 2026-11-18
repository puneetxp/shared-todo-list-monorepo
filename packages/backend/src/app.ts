import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authFunctionRoutes } from './functions/auth.js';
import { tasksFunctionRoutes } from './functions/tasks.js';
import type { TokenVerifier } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIST_DIR = path.resolve(__dirname, '../../frontend/dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface BuildAppOptions {
  verifyToken?: TokenVerifier;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  const corsOrigin =
    process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== 'http://localhost:5173'
      ? process.env.CORS_ORIGIN
      : true;

  app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'shared-todo-backend',
    timestamp: new Date().toISOString(),
  }));

  app.register(authFunctionRoutes, {
    prefix: '/api',
    verifyToken: options.verifyToken,
  });
  app.register(tasksFunctionRoutes, {
    prefix: '/api',
    verifyToken: options.verifyToken,
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'API route not found' });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({ error: 'Not found' });
    }

    if (!fs.existsSync(FRONTEND_DIST_DIR)) {
      return reply
        .code(200)
        .type('text/plain; charset=utf-8')
        .send('Frontend build not found. Run npm run build:frontend.');
    }

    const rawPath = request.url.split('?')[0] || '/';
    const safeRelPath = path
      .normalize(decodeURIComponent(rawPath))
      .replace(/^(\.\.[/\\])+/, '')
      .replace(/^[/\\]+/, '');

    const candidatePath = path.join(FRONTEND_DIST_DIR, safeRelPath);
    if (
      safeRelPath &&
      candidatePath.startsWith(FRONTEND_DIST_DIR) &&
      fs.existsSync(candidatePath) &&
      fs.statSync(candidatePath).isFile()
    ) {
      const ext = path.extname(candidatePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      return reply.code(200).type(mimeType).send(fs.readFileSync(candidatePath));
    }

    const indexPath = path.join(FRONTEND_DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return reply
        .code(200)
        .type('text/html; charset=utf-8')
        .send(fs.readFileSync(indexPath));
    }

    return reply.code(404).send({ error: 'Not found' });
  });

  return app;
}
