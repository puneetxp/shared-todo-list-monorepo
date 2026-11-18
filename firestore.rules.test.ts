/**
 * Phase 0 Payload-First Security TDD specification for Firestore Rules.
 * Verifies the 12 "Dirty Dozen" adversarial payloads against the hardened ruleset.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  actorUid: string;
  emailVerified: boolean;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const dirtyDozenCases: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Task Create',
    actorUid: 'userA',
    emailVerified: true,
    operation: 'create',
    path: 'tasks/task_1',
    payload: {
      title: 'Spoofed task',
      description: '',
      completed: false,
      ownerId: 'userB',
      ownerName: 'User B',
      sharedWithUids: [],
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    actorUid: 'userA',
    emailVerified: false,
    operation: 'create',
    path: 'tasks/task_2',
    payload: {
      title: 'Unverified write',
      description: '',
      completed: false,
      ownerId: 'userA',
      ownerName: 'User A',
      sharedWithUids: [],
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on Create',
    actorUid: 'userA',
    emailVerified: true,
    operation: 'create',
    path: 'tasks/task_3',
    payload: {
      title: 'Shadow task',
      description: '',
      completed: false,
      ownerId: 'userA',
      ownerName: 'User A',
      sharedWithUids: [],
      isAdmin: true,
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Update',
    actorUid: 'userA',
    emailVerified: true,
    operation: 'update',
    path: 'tasks/task_1',
    payload: {
      completed: true,
      isAdmin: true,
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Owner Hijack on Update',
    actorUid: 'userB',
    emailVerified: true,
    operation: 'update',
    path: 'tasks/task_1',
    payload: {
      ownerId: 'userB',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Client Timestamp Forgery',
    actorUid: 'userA',
    emailVerified: true,
    operation: 'create',
    path: 'tasks/task_6',
    payload: {
      title: 'Forged time',
      description: '',
      completed: false,
      ownerId: 'userA',
      ownerName: 'User A',
      sharedWithUids: [],
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'PII Blanket Read on /users',
    actorUid: 'userB',
    emailVerified: true,
    operation: 'get',
    path: 'users/userA',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Email Lookup Scraping',
    actorUid: 'userB',
    emailVerified: true,
    operation: 'list',
    path: 'emailLookup',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'ID Poisoning (>128 chars)',
    actorUid: 'userA',
    emailVerified: true,
    operation: 'create',
    path: `tasks/${'a'.repeat(200)}`,
    payload: {
      title: 'Long ID',
      description: '',
      completed: false,
      ownerId: 'userA',
      ownerName: 'User A',
      sharedWithUids: [],
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Value Poisoning (>255 char title)',
    actorUid: 'userA',
    emailVerified: true,
    operation: 'update',
    path: 'tasks/task_1',
    payload: {
      title: 'x'.repeat(500),
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unauthorized Task Delete by Collaborator',
    actorUid: 'userB',
    emailVerified: true,
    operation: 'delete',
    path: 'tasks/task_1',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Orphaned / Desynchronized Share Write',
    actorUid: 'userA',
    emailVerified: true,
    operation: 'create',
    path: 'tasks/task_1/shares/userB',
    payload: {
      uid: 'userB',
      displayName: 'User B',
      sharedBy: 'userA',
      createdAt: 'SERVER_TIMESTAMP',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
];
