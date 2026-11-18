import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { authenticateRequest, verifyBearerToken } from '../auth.js';

interface SyncBody {
  displayName?: string;
}

export const authFunctionRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  /**
   * POST /api/auth/sync
   * Serverless function handler for Login/Signup user sync & provisioning in PostgreSQL.
   */
  fastify.post<{ Body: SyncBody }>('/auth/sync', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing Authorization Bearer token' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const identity = await verifyBearerToken(token);
      const preferredName =
        request.body?.displayName?.trim() ||
        identity.name ||
        identity.email.split('@')[0] ||
        'User';

      const result = await pool.query(
        `INSERT INTO users (firebase_uid, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (firebase_uid)
         DO UPDATE SET
           email = EXCLUDED.email,
           display_name = COALESCE(NULLIF($3, ''), users.display_name),
           updated_at = NOW()
         RETURNING id, firebase_uid AS "firebaseUid", email, display_name AS "displayName", created_at AS "createdAt"`,
        [identity.uid, identity.email, preferredName]
      );

      return reply.code(200).send({
        user: result.rows[0],
      });
    } catch (err) {
      request.log.error(err, 'Failed to sync user in DB');
      return reply.code(401).send({ error: 'Authentication verification failed' });
    }
  });

  /**
   * GET /api/users
   * Returns registered users (excluding current user) to populate the share task popup.
   */
  fastify.get(
    '/users',
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user!;
      const result = await pool.query(
        `SELECT id, email, display_name AS "displayName"
         FROM users
         WHERE id != $1
         ORDER BY display_name ASC, email ASC`,
        [currentUser.id]
      );
      return reply.send({ users: result.rows });
    }
  );
};
