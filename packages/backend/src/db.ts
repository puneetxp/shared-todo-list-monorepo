import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

const { Pool } = pg;

let pgPool: pg.Pool | null = null;
try {
  if (process.env.DATABASE_URL) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_MAX_POOL || 5),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3000,
    });
    pgPool.on('error', (err) => {
      console.warn('PostgreSQL pool error:', err.message);
    });
  }
} catch {
  pgPool = null;
}

let usingFallbackStore = !pgPool;

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface TaskShareRow {
  id: string;
  task_id: string;
  shared_with_user_id: string;
  shared_by_user_id: string;
  created_at: string;
}

interface LocalDbData {
  users: UserRow[];
  tasks: TaskRow[];
  task_shares: TaskShareRow[];
}

const LOCAL_DB_FILE = path.resolve(process.cwd(), '.local-db.json');

function loadLocalDb(): LocalDbData {
  try {
    if (fs.existsSync(LOCAL_DB_FILE)) {
      return JSON.parse(fs.readFileSync(LOCAL_DB_FILE, 'utf8')) as LocalDbData;
    }
  } catch {
    // ignore corrupt file
  }
  return { users: [], tasks: [], task_shares: [] };
}

function saveLocalDb(data: LocalDbData): void {
  try {
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // ignore write error
  }
}

function executeFallbackQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): { rows: T[]; rowCount: number } {
  const db = loadLocalDb();
  const normalized = sql.replace(/\s+/g, ' ').trim();
  const now = new Date().toISOString();

  // 1. Upsert user on login/signup
  if (normalized.startsWith('INSERT INTO users')) {
    const firebaseUid = String(params[0]);
    const email = String(params[1]).toLowerCase();
    const displayName = String(params[2] || email.split('@')[0]);

    let user = db.users.find(
      (u) => u.firebase_uid === firebaseUid || u.email.toLowerCase() === email
    );
    if (user) {
      user.email = email;
      if (displayName) user.display_name = displayName;
      user.updated_at = now;
    } else {
      user = {
        id: crypto.randomUUID(),
        firebase_uid: firebaseUid,
        email,
        display_name: displayName,
        created_at: now,
        updated_at: now,
      };
      db.users.push(user);
    }
    saveLocalDb(db);

    if (normalized.includes(' AS "firebaseUid"')) {
      return {
        rows: [
          {
            id: user.id,
            firebaseUid: user.firebase_uid,
            email: user.email,
            displayName: user.display_name,
            createdAt: user.created_at,
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    return { rows: [user as unknown as T], rowCount: 1 };
  }

  // 2. List other users (GET /api/users)
  if (
    normalized.includes('FROM users WHERE id != $1')
  ) {
    const currentUserId = String(params[0]);
    const rows = db.users
      .filter((u) => u.id !== currentUserId)
      .map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { rows: rows as unknown as T[], rowCount: rows.length };
  }

  // 3. Find target user for sharing
  if (
    normalized.includes('FROM users WHERE LOWER(email) = LOWER($1)')
  ) {
    const identifier = String(params[0]).toLowerCase();
    const found = db.users.find(
      (u) => u.email.toLowerCase() === identifier || u.id === params[0]
    );
    return {
      rows: found ? ([found] as unknown as T[]) : [],
      rowCount: found ? 1 : 0,
    };
  }

  // 4. Insert task
  if (normalized.startsWith('INSERT INTO tasks')) {
    const title = String(params[0]);
    const description = String(params[1] ?? '');
    const ownerId = String(params[2]);
    const task: TaskRow = {
      id: crypto.randomUUID(),
      title,
      description,
      completed: false,
      owner_id: ownerId,
      created_at: now,
      updated_at: now,
    };
    db.tasks.push(task);
    saveLocalDb(db);
    return {
      rows: [
        {
          id: task.id,
          title: task.title,
          description: task.description,
          completed: task.completed,
          ownerId: task.owner_id,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
        } as unknown as T,
      ],
      rowCount: 1,
    };
  }

  // 5. Access check on task
  if (
    normalized.startsWith('SELECT t.id FROM tasks t') ||
    normalized.startsWith('SELECT t.owner_id FROM tasks t')
  ) {
    const taskId = String(params[0]);
    const userId = String(params[1]);
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) return { rows: [], rowCount: 0 };
    const isShared = db.task_shares.some(
      (ts) => ts.task_id === taskId && ts.shared_with_user_id === userId
    );
    if (task.owner_id !== userId && !isShared) {
      return { rows: [], rowCount: 0 };
    }
    return {
      rows: [{ id: task.id, owner_id: task.owner_id } as unknown as T],
      rowCount: 1,
    };
  }

  // 6. Update task
  if (normalized.startsWith('UPDATE tasks')) {
    const taskId = String(params[0]);
    const title = params[1] as string | null;
    const description = params[2] as string | null;
    const completed = params[3] as boolean | null;
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) return { rows: [], rowCount: 0 };
    if (title !== null && title !== undefined) task.title = title;
    if (description !== null && description !== undefined)
      task.description = description;
    if (completed !== null && completed !== undefined)
      task.completed = Boolean(completed);
    task.updated_at = now;
    saveLocalDb(db);
    return { rows: [{ id: task.id } as unknown as T], rowCount: 1 };
  }

  // 7. Select single full task after update
  if (
    normalized.includes('FROM tasks t INNER JOIN users owner') &&
    normalized.includes('WHERE t.id = $1')
  ) {
    const taskId = String(params[0]);
    const userId = String(params[1]);
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) return { rows: [], rowCount: 0 };
    const owner = db.users.find((u) => u.id === task.owner_id);
    const sharedWith = db.task_shares
      .filter((ts) => ts.task_id === task.id)
      .map((ts) => db.users.find((u) => u.id === ts.shared_with_user_id))
      .filter((u): u is UserRow => Boolean(u))
      .map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
      }));
    return {
      rows: [
        {
          id: task.id,
          title: task.title,
          description: task.description,
          completed: task.completed,
          ownerId: task.owner_id,
          ownerEmail: owner?.email || '',
          ownerName: owner?.display_name || 'User',
          isOwner: task.owner_id === userId,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          sharedWith,
        } as unknown as T,
      ],
      rowCount: 1,
    };
  }

  // 8. List tasks with filter (all / my / shared)
  if (normalized.includes('FROM tasks t INNER JOIN users owner')) {
    const userId = String(params[0]);
    const isMyOnly = normalized.includes('WHERE t.owner_id = $1');
    const isSharedOnly = normalized.includes('WHERE (t.owner_id != $1');

    const rows = db.tasks
      .filter((t) => {
        const sharedWithMe = db.task_shares.some(
          (ts) => ts.task_id === t.id && ts.shared_with_user_id === userId
        );
        if (isMyOnly) return t.owner_id === userId;
        if (isSharedOnly) return t.owner_id !== userId && sharedWithMe;
        return t.owner_id === userId || sharedWithMe;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((t) => {
        const owner = db.users.find((u) => u.id === t.owner_id);
        const sharedWith = db.task_shares
          .filter((ts) => ts.task_id === t.id)
          .map((ts) => db.users.find((u) => u.id === ts.shared_with_user_id))
          .filter((u): u is UserRow => Boolean(u))
          .map((u) => ({
            id: u.id,
            email: u.email,
            displayName: u.display_name,
          }));
        return {
          id: t.id,
          title: t.title,
          description: t.description,
          completed: t.completed,
          ownerId: t.owner_id,
          ownerEmail: owner?.email || '',
          ownerName: owner?.display_name || 'User',
          isOwner: t.owner_id === userId,
          createdAt: t.created_at,
          updatedAt: t.updated_at,
          sharedWith,
        };
      });

    return { rows: rows as unknown as T[], rowCount: rows.length };
  }

  // 9. Delete task
  if (normalized.startsWith('DELETE FROM tasks')) {
    const taskId = String(params[0]);
    const userId = String(params[1]);
    const idx = db.tasks.findIndex(
      (t) => t.id === taskId && t.owner_id === userId
    );
    if (idx === -1) return { rows: [], rowCount: 0 };
    db.tasks.splice(idx, 1);
    db.task_shares = db.task_shares.filter((ts) => ts.task_id !== taskId);
    saveLocalDb(db);
    return { rows: [{ id: taskId } as unknown as T], rowCount: 1 };
  }

  // 10. Insert task share
  if (normalized.startsWith('INSERT INTO task_shares')) {
    const taskId = String(params[0]);
    const sharedWithUserId = String(params[1]);
    const sharedByUserId = String(params[2]);
    const exists = db.task_shares.some(
      (ts) =>
        ts.task_id === taskId && ts.shared_with_user_id === sharedWithUserId
    );
    if (!exists) {
      db.task_shares.push({
        id: crypto.randomUUID(),
        task_id: taskId,
        shared_with_user_id: sharedWithUserId,
        shared_by_user_id: sharedByUserId,
        created_at: now,
      });
      saveLocalDb(db);
    }
    return { rows: [], rowCount: 1 };
  }

  // 11. Select owner_id from tasks
  if (normalized.startsWith('SELECT owner_id FROM tasks WHERE id = $1')) {
    const taskId = String(params[0]);
    const task = db.tasks.find((t) => t.id === taskId);
    return {
      rows: task ? ([{ owner_id: task.owner_id }] as unknown as T[]) : [],
      rowCount: task ? 1 : 0,
    };
  }

  // 12. Delete task share
  if (normalized.startsWith('DELETE FROM task_shares')) {
    const taskId = String(params[0]);
    const targetUserId = String(params[1]);
    const before = db.task_shares.length;
    db.task_shares = db.task_shares.filter(
      (ts) =>
        !(ts.task_id === taskId && ts.shared_with_user_id === targetUserId)
    );
    saveLocalDb(db);
    return { rows: [], rowCount: before - db.task_shares.length };
  }

  return { rows: [], rowCount: 0 };
}

export const pool = {
  async query<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    if (usingFallbackStore || !pgPool) {
      return executeFallbackQuery<T>(text, values);
    }
    return pgPool.query<T>(text, values);
  },
};

export async function initializeDatabase(): Promise<void> {
  if (!pgPool) {
    usingFallbackStore = true;
    console.warn(
      'DATABASE_URL not set — using local file store (.local-db.json).'
    );
    return;
  }
  try {
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";

        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          firebase_uid VARCHAR(128) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          display_name VARCHAR(100) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

        CREATE TABLE IF NOT EXISTS tasks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(255) NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          completed BOOLEAN NOT NULL DEFAULT FALSE,
          owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_owner_id ON tasks(owner_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

        CREATE TABLE IF NOT EXISTS task_shares (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          shared_with_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          shared_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT unique_task_user_share UNIQUE (task_id, shared_with_user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_task_shares_shared_with ON task_shares(shared_with_user_id);
        CREATE INDEX IF NOT EXISTS idx_task_shares_task_id ON task_shares(task_id);
      `);
      console.log('Connected to PostgreSQL database.');
    } finally {
      client.release();
    }
  } catch (err) {
    usingFallbackStore = true;
    console.warn(
      'PostgreSQL not reachable — automatically switched to ultra-low-RAM local file store (.local-db.json).'
    );
  }
}
