import { FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { pool } from './db.js';

export interface AuthenticatedUser {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

let firebaseInitialized = false;

function readAppletProjectId(): string | undefined {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.resolve(
      __dirname,
      '../../../firebase-applet-config.json'
    );
    if (!fs.existsSync(configPath)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      projectId?: string;
    };
    if (parsed.projectId && parsed.projectId !== 'remixed-project-id') {
      return parsed.projectId;
    }
  } catch {
    // ignore invalid config file
  }
  return undefined;
}

function initFirebaseAdmin(): boolean {
  if (firebaseInitialized) return true;
  if (getApps().length > 0) {
    firebaseInitialized = true;
    return true;
  }

  const envProjectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (
    envProjectId &&
    clientEmail &&
    privateKey &&
    envProjectId !== 'your-firebase-project-id' &&
    !privateKey.includes('YOUR_PRIVATE_KEY')
  ) {
    try {
      initializeApp({
        credential: cert({
          projectId: envProjectId,
          clientEmail,
          privateKey,
        }),
      });
      firebaseInitialized = true;
      return true;
    } catch (err) {
      console.warn(
        'Firebase Admin service-account init failed, checking projectId-only verification:',
        err
      );
    }
  }

  const projectId =
    (envProjectId && envProjectId !== 'your-firebase-project-id'
      ? envProjectId
      : undefined) || readAppletProjectId();

  if (projectId) {
    try {
      if (getApps().length === 0) {
        initializeApp({ projectId });
      } else {
        getApp();
      }
      firebaseInitialized = true;
      return true;
    } catch (err) {
      console.warn('Firebase Admin projectId initialization failed:', err);
    }
  }

  return false;
}

interface DecodedTokenIdentity {
  uid: string;
  email: string;
  name?: string;
}

export type TokenVerifier = (token: string) => Promise<DecodedTokenIdentity>;

export async function verifyBearerToken(
  token: string
): Promise<DecodedTokenIdentity> {
  if (initFirebaseAdmin()) {
    const decoded = await getAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: (decoded.email || `${decoded.uid}@user.local`).toLowerCase(),
      name: decoded.name,
    };
  }

  // Fallback for local evaluation tokens when Firebase is not configured
  if (token.startsWith('local:')) {
    const raw = Buffer.from(token.slice('local:'.length), 'base64').toString(
      'utf8'
    );
    const parsed = JSON.parse(raw) as {
      uid: string;
      email: string;
      displayName?: string;
    };
    if (!parsed.uid || !parsed.email) {
      throw new Error('Invalid local auth token');
    }
    return {
      uid: parsed.uid,
      email: parsed.email.toLowerCase(),
      name: parsed.displayName,
    };
  }

  throw new Error('Invalid or unverifiable authentication token');
}

export function createAuthenticateRequest(
  verifyToken: TokenVerifier = verifyBearerToken
) {
  return async function authenticateWithVerifier(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const identity = await verifyToken(token);
      const displayName =
        identity.name || identity.email.split('@')[0] || 'User';

      const result = await pool.query<{
        id: string;
        firebase_uid: string;
        email: string;
        display_name: string;
      }>(
        `INSERT INTO users (firebase_uid, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (firebase_uid)
         DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
         RETURNING id, firebase_uid, email, display_name`,
        [identity.uid, identity.email, displayName]
      );

      const row = result.rows[0];
      request.user = {
        id: row.id,
        firebaseUid: row.firebase_uid,
        email: row.email,
        displayName: row.display_name,
      };
    } catch (err) {
      request.log.error(err, 'Authentication failed');
      reply.code(401).send({ error: 'Unauthorized: invalid token' });
    }
  };
}

export const authenticateRequest = createAuthenticateRequest(verifyBearerToken);
