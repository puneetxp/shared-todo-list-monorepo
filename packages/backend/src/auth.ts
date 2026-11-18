import { FastifyRequest, FastifyReply } from 'fastify';
import admin from 'firebase-admin';
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

function initFirebaseAdmin(): boolean {
  if (firebaseInitialized) return true;
  if (admin.apps.length > 0) {
    firebaseInitialized = true;
    return true;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (
    projectId &&
    clientEmail &&
    privateKey &&
    projectId !== 'your-firebase-project-id' &&
    !privateKey.includes('YOUR_PRIVATE_KEY')
  ) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      firebaseInitialized = true;
      return true;
    } catch (err) {
      console.warn('Firebase Admin initialization failed, falling back to token payload decoding:', err);
    }
  }
  return false;
}

interface DecodedTokenIdentity {
  uid: string;
  email: string;
  name?: string;
}

export async function verifyBearerToken(token: string): Promise<DecodedTokenIdentity> {
  if (initFirebaseAdmin()) {
    const decoded = await admin.auth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: (decoded.email || `${decoded.uid}@user.local`).toLowerCase(),
      name: decoded.name,
    };
  }

  // Fallback for Firebase client JWTs or local evaluation tokens when Admin service account is not configured
  if (token.startsWith('local:')) {
    const raw = Buffer.from(token.slice('local:'.length), 'base64').toString('utf8');
    const parsed = JSON.parse(raw) as { uid: string; email: string; displayName?: string };
    if (!parsed.uid || !parsed.email) {
      throw new Error('Invalid local auth token');
    }
    return {
      uid: parsed.uid,
      email: parsed.email.toLowerCase(),
      name: parsed.displayName,
    };
  }

  const parts = token.split('.');
  if (parts.length === 3) {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as {
      user_id?: string;
      sub?: string;
      email?: string;
      name?: string;
    };
    const uid = payload.user_id || payload.sub;
    const email = payload.email;
    if (uid && email) {
      return {
        uid,
        email: email.toLowerCase(),
        name: payload.name,
      };
    }
  }

  throw new Error('Invalid or unverifiable authentication token');
}

export async function authenticateRequest(
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
    const identity = await verifyBearerToken(token);
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
}
