import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { authenticateRequest } from '../auth.js';

interface TaskFilterQuery {
  filter?: 'all' | 'my' | 'shared';
}

interface CreateTaskBody {
  title: string;
  description?: string;
}

interface UpdateTaskBody {
  title?: string;
  description?: string;
  completed?: boolean;
}

interface ShareTaskBody {
  emailOrUserId: string;
}

export const tasksFunctionRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  fastify.addHook('preHandler', authenticateRequest);

  /**
   * GET /api/tasks?filter=all|my|shared
   * Lists tasks created by or shared with the authenticated user.
   */
  fastify.get<{ Querystring: TaskFilterQuery }>(
    '/tasks',
    async (request, reply) => {
      const userId = request.user!.id;
      const filter = request.query.filter || 'all';

      let filterClause = `(t.owner_id = $1 OR ts_me.shared_with_user_id = $1)`;
      if (filter === 'my') {
        filterClause = `t.owner_id = $1`;
      } else if (filter === 'shared') {
        filterClause = `(t.owner_id != $1 AND ts_me.shared_with_user_id = $1)`;
      }

      const query = `
        SELECT
          t.id,
          t.title,
          t.description,
          t.completed,
          t.owner_id AS "ownerId",
          owner.email AS "ownerEmail",
          owner.display_name AS "ownerName",
          (t.owner_id = $1) AS "isOwner",
          t.created_at AS "createdAt",
          t.updated_at AS "updatedAt",
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', su.id,
                'email', su.email,
                'displayName', su.display_name
              )
            ) FILTER (WHERE su.id IS NOT NULL),
            '[]'::json
          ) AS "sharedWith"
        FROM tasks t
        INNER JOIN users owner ON owner.id = t.owner_id
        LEFT JOIN task_shares ts_me
          ON ts_me.task_id = t.id AND ts_me.shared_with_user_id = $1
        LEFT JOIN task_shares ts_all
          ON ts_all.task_id = t.id
        LEFT JOIN users su
          ON su.id = ts_all.shared_with_user_id
        WHERE ${filterClause}
        GROUP BY t.id, owner.id
        ORDER BY t.created_at DESC
      `;

      const result = await pool.query(query, [userId]);
      return reply.send({ tasks: result.rows });
    }
  );

  /**
   * POST /api/tasks
   * Create a new task owned by the authenticated user.
   */
  fastify.post<{ Body: CreateTaskBody }>('/tasks', async (request, reply) => {
    const user = request.user!;
    const title = request.body?.title?.trim();
    const description = request.body?.description?.trim() ?? '';

    if (!title) {
      return reply.code(400).send({ error: 'Task title is required' });
    }

    const result = await pool.query(
      `INSERT INTO tasks (title, description, completed, owner_id)
       VALUES ($1, $2, FALSE, $3)
       RETURNING
         id,
         title,
         description,
         completed,
         owner_id AS "ownerId",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [title, description, user.id]
    );

    const created = result.rows[0];
    return reply.code(201).send({
      task: {
        ...created,
        ownerEmail: user.email,
        ownerName: user.displayName,
        isOwner: true,
        sharedWith: [],
      },
    });
  });

  /**
   * PUT /api/tasks/:id
   * Update a task (accessible to the task owner or a user the task is shared with).
   */
  fastify.put<{ Params: { id: string }; Body: UpdateTaskBody }>(
    '/tasks/:id',
    async (request, reply) => {
      const userId = request.user!.id;
      const taskId = request.params.id;
      const { title, description, completed } = request.body || {};

      const accessCheck = await pool.query(
        `SELECT t.id
         FROM tasks t
         LEFT JOIN task_shares ts ON ts.task_id = t.id AND ts.shared_with_user_id = $2
         WHERE t.id = $1 AND (t.owner_id = $2 OR ts.shared_with_user_id = $2)`,
        [taskId, userId]
      );

      if (accessCheck.rowCount === 0) {
        return reply.code(404).send({ error: 'Task not found or access denied' });
      }

      const updateResult = await pool.query(
        `UPDATE tasks
         SET
           title = COALESCE($2, title),
           description = COALESCE($3, description),
           completed = COALESCE($4, completed),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [
          taskId,
          title !== undefined ? title.trim() : null,
          description !== undefined ? description.trim() : null,
          completed !== undefined ? Boolean(completed) : null,
        ]
      );

      if (updateResult.rowCount === 0) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      const fullTask = await pool.query(
        `SELECT
          t.id,
          t.title,
          t.description,
          t.completed,
          t.owner_id AS "ownerId",
          owner.email AS "ownerEmail",
          owner.display_name AS "ownerName",
          (t.owner_id = $2) AS "isOwner",
          t.created_at AS "createdAt",
          t.updated_at AS "updatedAt",
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', su.id,
                'email', su.email,
                'displayName', su.display_name
              )
            ) FILTER (WHERE su.id IS NOT NULL),
            '[]'::json
          ) AS "sharedWith"
        FROM tasks t
        INNER JOIN users owner ON owner.id = t.owner_id
        LEFT JOIN task_shares ts_all ON ts_all.task_id = t.id
        LEFT JOIN users su ON su.id = ts_all.shared_with_user_id
        WHERE t.id = $1
        GROUP BY t.id, owner.id`,
        [taskId, userId]
      );

      return reply.send({ task: fullTask.rows[0] });
    }
  );

  /**
   * DELETE /api/tasks/:id
   * Delete a task (only the owner can delete a task).
   */
  fastify.delete<{ Params: { id: string } }>(
    '/tasks/:id',
    async (request, reply) => {
      const userId = request.user!.id;
      const taskId = request.params.id;

      const result = await pool.query(
        `DELETE FROM tasks WHERE id = $1 AND owner_id = $2 RETURNING id`,
        [taskId, userId]
      );

      if (result.rowCount === 0) {
        return reply
          .code(403)
          .send({ error: 'Only the task owner can delete this task (or task not found)' });
      }

      return reply.send({ deletedId: taskId });
    }
  );

  /**
   * POST /api/tasks/:id/share
   * Share a task with another registered user by email or user UUID.
   */
  fastify.post<{ Params: { id: string }; Body: ShareTaskBody }>(
    '/tasks/:id/share',
    async (request, reply) => {
      const currentUser = request.user!;
      const taskId = request.params.id;
      const identifier = request.body?.emailOrUserId?.trim();

      if (!identifier) {
        return reply
          .code(400)
          .send({ error: 'Please provide a user email or user ID to share with' });
      }

      // Check task exists and current user has access to share it
      const taskResult = await pool.query<{ owner_id: string }>(
        `SELECT t.owner_id
         FROM tasks t
         LEFT JOIN task_shares ts ON ts.task_id = t.id AND ts.shared_with_user_id = $2
         WHERE t.id = $1 AND (t.owner_id = $2 OR ts.shared_with_user_id = $2)`,
        [taskId, currentUser.id]
      );

      if (taskResult.rowCount === 0) {
        return reply.code(404).send({ error: 'Task not found or access denied' });
      }

      const targetUserResult = await pool.query<{
        id: string;
        email: string;
        display_name: string;
      }>(
        `SELECT id, email, display_name
         FROM users
         WHERE LOWER(email) = LOWER($1) OR id::text = $1
         LIMIT 1`,
        [identifier]
      );

      if (targetUserResult.rowCount === 0) {
        return reply.code(404).send({
          error: `No registered user found with email/ID "${identifier}". Ask them to sign up first!`,
        });
      }

      const targetUser = targetUserResult.rows[0];
      if (targetUser.id === taskResult.rows[0].owner_id) {
        return reply
          .code(400)
          .send({ error: 'Cannot share a task with its owner' });
      }

      await pool.query(
        `INSERT INTO task_shares (task_id, shared_with_user_id, shared_by_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (task_id, shared_with_user_id) DO NOTHING`,
        [taskId, targetUser.id, currentUser.id]
      );

      return reply.code(200).send({
        sharedWithUser: {
          id: targetUser.id,
          email: targetUser.email,
          displayName: targetUser.display_name,
        },
      });
    }
  );

  /**
   * DELETE /api/tasks/:id/share/:targetUserId
   * Revoke task share access for a specific user.
   */
  fastify.delete<{ Params: { id: string; targetUserId: string } }>(
    '/tasks/:id/share/:targetUserId',
    async (request, reply) => {
      const currentUser = request.user!;
      const { id: taskId, targetUserId } = request.params;

      const taskCheck = await pool.query<{ owner_id: string }>(
        `SELECT owner_id FROM tasks WHERE id = $1`,
        [taskId]
      );

      if (taskCheck.rowCount === 0) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      const isOwner = taskCheck.rows[0].owner_id === currentUser.id;
      if (!isOwner && currentUser.id !== targetUserId) {
        return reply
          .code(403)
          .send({ error: 'Only the task owner or the shared user can remove sharing' });
      }

      await pool.query(
        `DELETE FROM task_shares WHERE task_id = $1 AND shared_with_user_id = $2`,
        [taskId, targetUserId]
      );

      return reply.send({ removedUserId: targetUserId });
    }
  );
};
