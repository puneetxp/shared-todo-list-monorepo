import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { initializeDatabase } from '../src/db.js';
import type { TokenVerifier } from '../src/auth.js';

const LOCAL_DB_PATH = path.resolve(process.cwd(), '.local-db.json');
let previousLocalDb: string | null = null;

const TEST_USERS: Record<string, { uid: string; email: string; name: string }> = {
  'token-alice': {
    uid: 'uid_alice_test',
    email: 'alice@example.com',
    name: 'Alice',
  },
  'token-bob': {
    uid: 'uid_bob_test',
    email: 'bob@example.com',
    name: 'Bob',
  },
  'token-charlie': {
    uid: 'uid_charlie_test',
    email: 'charlie@example.com',
    name: 'Charlie',
  },
};

const mockVerifyToken: TokenVerifier = async (token: string) => {
  const identity = TEST_USERS[token];
  if (!identity) {
    throw new Error('Invalid test token');
  }
  return identity;
};

before(async () => {
  if (fs.existsSync(LOCAL_DB_PATH)) {
    previousLocalDb = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
    fs.unlinkSync(LOCAL_DB_PATH);
  }
  await initializeDatabase();
});

after(() => {
  if (fs.existsSync(LOCAL_DB_PATH)) {
    fs.unlinkSync(LOCAL_DB_PATH);
  }
  if (previousLocalDb !== null) {
    fs.writeFileSync(LOCAL_DB_PATH, previousLocalDb, 'utf8');
  }
});

test('GET /api/health returns 200 ok', async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'shared-todo-backend');
  await app.close();
});

test('Protected endpoints reject missing or invalid Firebase tokens with 401', async () => {
  const app = buildApp({ logger: false });

  const missingHeader = await app.inject({ method: 'GET', url: '/api/tasks' });
  assert.equal(missingHeader.statusCode, 401);

  const invalidToken = await app.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: { authorization: 'Bearer invalid.jwt.token' },
  });
  assert.equal(invalidToken.statusCode, 401);

  const invalidSync = await app.inject({
    method: 'POST',
    url: '/api/auth/sync',
    headers: { authorization: 'Bearer invalid.jwt.token' },
    payload: {},
  });
  assert.equal(invalidSync.statusCode, 401);

  await app.close();
});

test('Full Auth Sync, Task CRUD, Filtering, and Sharing workflow', async () => {
  const app = buildApp({ logger: false, verifyToken: mockVerifyToken });

  // 1. Sync Alice, Bob, Charlie
  const syncAlice = await app.inject({
    method: 'POST',
    url: '/api/auth/sync',
    headers: { authorization: 'Bearer token-alice' },
    payload: { displayName: 'Alice' },
  });
  assert.equal(syncAlice.statusCode, 200);
  const alice = syncAlice.json().user;
  assert.equal(alice.email, 'alice@example.com');

  const syncBob = await app.inject({
    method: 'POST',
    url: '/api/auth/sync',
    headers: { authorization: 'Bearer token-bob' },
    payload: { displayName: 'Bob' },
  });
  assert.equal(syncBob.statusCode, 200);
  const bob = syncBob.json().user;

  const syncCharlie = await app.inject({
    method: 'POST',
    url: '/api/auth/sync',
    headers: { authorization: 'Bearer token-charlie' },
    payload: { displayName: 'Charlie' },
  });
  assert.equal(syncCharlie.statusCode, 200);

  // 2. List registered users (excluding caller)
  const usersRes = await app.inject({
    method: 'GET',
    url: '/api/users',
    headers: { authorization: 'Bearer token-alice' },
  });
  assert.equal(usersRes.statusCode, 200);
  const userEmails = usersRes.json().users.map((u: { email: string }) => u.email);
  assert.ok(userEmails.includes('bob@example.com'));
  assert.ok(!userEmails.includes('alice@example.com'));

  // 3. Reject empty task title
  const badTask = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { authorization: 'Bearer token-alice' },
    payload: { title: '   ' },
  });
  assert.equal(badTask.statusCode, 400);

  // 4. Create task as Alice
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { authorization: 'Bearer token-alice' },
    payload: { title: 'Ship Cloud Run build', description: 'Verify tests' },
  });
  assert.equal(createRes.statusCode, 201);
  const createdTask = createRes.json().task;
  assert.equal(createdTask.title, 'Ship Cloud Run build');
  assert.equal(createdTask.completed, false);
  assert.equal(createdTask.isOwner, true);

  // 5. Share task with Bob
  const shareRes = await app.inject({
    method: 'POST',
    url: `/api/tasks/${createdTask.id}/share`,
    headers: { authorization: 'Bearer token-alice' },
    payload: { emailOrUserId: 'bob@example.com' },
  });
  assert.equal(shareRes.statusCode, 200);
  assert.equal(shareRes.json().sharedWithUser.email, 'bob@example.com');

  // Cannot share with owner
  const shareOwnerRes = await app.inject({
    method: 'POST',
    url: `/api/tasks/${createdTask.id}/share`,
    headers: { authorization: 'Bearer token-alice' },
    payload: { emailOrUserId: 'alice@example.com' },
  });
  assert.equal(shareOwnerRes.statusCode, 400);

  // Unknown user returns 404
  const shareMissingRes = await app.inject({
    method: 'POST',
    url: `/api/tasks/${createdTask.id}/share`,
    headers: { authorization: 'Bearer token-alice' },
    payload: { emailOrUserId: 'nobody@example.com' },
  });
  assert.equal(shareMissingRes.statusCode, 404);

  // 6. Filter checks (all / my / shared) for Bob and Charlie
  const bobShared = await app.inject({
    method: 'GET',
    url: '/api/tasks?filter=shared',
    headers: { authorization: 'Bearer token-bob' },
  });
  assert.equal(bobShared.statusCode, 200);
  assert.equal(bobShared.json().tasks.length, 1);
  assert.equal(bobShared.json().tasks[0].isOwner, false);

  const bobMy = await app.inject({
    method: 'GET',
    url: '/api/tasks?filter=my',
    headers: { authorization: 'Bearer token-bob' },
  });
  assert.equal(bobMy.statusCode, 200);
  assert.equal(bobMy.json().tasks.length, 0);

  const charlieAll = await app.inject({
    method: 'GET',
    url: '/api/tasks?filter=all',
    headers: { authorization: 'Bearer token-charlie' },
  });
  assert.equal(charlieAll.statusCode, 200);
  assert.equal(charlieAll.json().tasks.length, 0);

  // 7. Bob updates task; Charlie is denied (404); empty title rejected (400)
  const emptyTitleUpdate = await app.inject({
    method: 'PUT',
    url: `/api/tasks/${createdTask.id}`,
    headers: { authorization: 'Bearer token-bob' },
    payload: { title: '   ' },
  });
  assert.equal(emptyTitleUpdate.statusCode, 400);

  const bobUpdate = await app.inject({
    method: 'PUT',
    url: `/api/tasks/${createdTask.id}`,
    headers: { authorization: 'Bearer token-bob' },
    payload: { completed: true },
  });
  assert.equal(bobUpdate.statusCode, 200);
  assert.equal(bobUpdate.json().task.completed, true);

  const charlieUpdate = await app.inject({
    method: 'PUT',
    url: `/api/tasks/${createdTask.id}`,
    headers: { authorization: 'Bearer token-charlie' },
    payload: { completed: false },
  });
  assert.equal(charlieUpdate.statusCode, 404);

  // 8. Bob cannot delete Alice's task (403)
  const bobDelete = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${createdTask.id}`,
    headers: { authorization: 'Bearer token-bob' },
  });
  assert.equal(bobDelete.statusCode, 403);

  // 9. Alice revokes Bob's share
  const unshareRes = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${createdTask.id}/share/${bob.id}`,
    headers: { authorization: 'Bearer token-alice' },
  });
  assert.equal(unshareRes.statusCode, 200);

  const bobAfterUnshare = await app.inject({
    method: 'GET',
    url: '/api/tasks?filter=all',
    headers: { authorization: 'Bearer token-bob' },
  });
  assert.equal(bobAfterUnshare.json().tasks.length, 0);

  // 10. Alice deletes her task
  const aliceDelete = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${createdTask.id}`,
    headers: { authorization: 'Bearer token-alice' },
  });
  assert.equal(aliceDelete.statusCode, 200);

  await app.close();
});
