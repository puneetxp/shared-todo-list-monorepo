import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  firebaseAuth,
  firestoreDb,
  isFirebaseConfigured,
  OperationType,
  handleFirestoreError,
} from '../firebase';
import type { UserProfile } from '../types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || '/api';

interface LocalStoredAccount {
  uid: string;
  email: string;
  password: string;
  displayName: string;
}

const LOCAL_ACCOUNTS_KEY = 'shared_todo_local_accounts';
const LOCAL_SESSION_KEY = 'shared_todo_local_session';

function normalizeEmailId(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}@sharedtodo.app`;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function syncUserToFirestore(
  fbUser: FirebaseUser,
  preferredName?: string
): Promise<void> {
  if (!firestoreDb || !fbUser.emailVerified || !fbUser.email) {
    return;
  }

  const email = fbUser.email.trim().toLowerCase().slice(0, 255);
  const displayName = (
    preferredName?.trim() ||
    fbUser.displayName?.trim() ||
    email.split('@')[0] ||
    'User'
  ).slice(0, 100);

  const userPath = `users/${fbUser.uid}`;
  const userRef = doc(firestoreDb, 'users', fbUser.uid);
  try {
    const existingSnap = await getDoc(userRef);
    if (existingSnap.exists()) {
      await updateDoc(userRef, {
        email,
        displayName,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(userRef, {
        uid: fbUser.uid,
        email,
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }

  const emailHash = await sha256Hex(email);
  const lookupPath = `emailLookup/${emailHash}`;
  const lookupRef = doc(firestoreDb, 'emailLookup', emailHash);
  try {
    const existingLookup = await getDoc(lookupRef);
    if (existingLookup.exists()) {
      await updateDoc(lookupRef, {
        displayName,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(lookupRef, {
        uid: fbUser.uid,
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, lookupPath);
  }
}

function createLocalToken(account: {
  uid: string;
  email: string;
  displayName: string;
}): string {
  const payload = JSON.stringify({
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
  });
  return `local:${btoa(unescape(encodeURIComponent(payload)))}`;
}

function formatFirebaseAuthError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: unknown }).code);
    if (code === 'auth/operation-not-allowed') {
      return 'Email/Password sign-in is not enabled in the Firebase Console yet. Enable it under Authentication -> Sign-in method, or click "Continue with Google".';
    }
    if (code === 'auth/email-already-in-use') {
      return 'An account with this email already exists.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'Invalid email / user ID or password.';
    }
    if (code === 'auth/weak-password') {
      return 'Password must be at least 6 characters long.';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'Google sign-in popup was closed before completing login.';
    }
  }
  return err instanceof Error ? err.message : fallback;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserProfile | null>(null);
  const token = ref<string | null>(null);
  const loading = ref<boolean>(true);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(user.value && token.value));

  async function syncWithBackend(
    authToken: string,
    displayName?: string
  ): Promise<UserProfile> {
    const response = await fetch(`${API_BASE_URL}/auth/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ displayName }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to synchronize user with backend');
    }

    const data = (await response.json()) as { user: UserProfile };
    user.value = data.user;
    token.value = authToken;
    return data.user;
  }

  async function initializeAuth(): Promise<void> {
    loading.value = true;
    error.value = null;

    if (isFirebaseConfigured && firebaseAuth) {
      await new Promise<void>((resolve) => {
        const unsubscribe = onAuthStateChanged(
          firebaseAuth!,
          async (fbUser) => {
            unsubscribe();
            if (fbUser) {
              try {
                const idToken = await fbUser.getIdToken();
                await syncWithBackend(idToken, fbUser.displayName || undefined);
                await syncUserToFirestore(fbUser, fbUser.displayName || undefined).catch((err) => {
                  console.warn('Firestore profile sync skipped:', err);
                });
              } catch (err) {
                console.error('Auth sync error:', err);
                user.value = null;
                token.value = null;
              }
            }
            loading.value = false;
            resolve();
          }
        );
      });
      return;
    }

    // Local Firebase-compatible session restore
    try {
      const savedSession = localStorage.getItem(LOCAL_SESSION_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession) as {
          uid: string;
          email: string;
          displayName: string;
        };
        const localToken = createLocalToken(parsed);
        await syncWithBackend(localToken, parsed.displayName);
      }
    } catch (err) {
      console.warn('Could not restore session:', err);
      localStorage.removeItem(LOCAL_SESSION_KEY);
    } finally {
      loading.value = false;
    }
  }

  async function register(
    idOrEmail: string,
    password: string,
    displayName: string
  ): Promise<void> {
    error.value = null;
    loading.value = true;
    const email = normalizeEmailId(idOrEmail);
    const cleanName =
      displayName.trim() || email.split('@')[0] || 'User';

    try {
      if (isFirebaseConfigured && firebaseAuth) {
        const credential = await createUserWithEmailAndPassword(
          firebaseAuth,
          email,
          password
        );
        await updateProfile(credential.user, { displayName: cleanName });
        const idToken = await credential.user.getIdToken(true);
        await syncWithBackend(idToken, cleanName);
        return;
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      const rawAccounts = localStorage.getItem(LOCAL_ACCOUNTS_KEY);
      const accounts: LocalStoredAccount[] = rawAccounts
        ? JSON.parse(rawAccounts)
        : [];

      const existing = accounts.find((a) => a.email === email);
      if (existing) {
        throw new Error('An account with this ID / Email already exists');
      }

      const newAccount: LocalStoredAccount = {
        uid: `fb_${email.replace(/[^a-z0-9]/g, '_')}`,
        email,
        password,
        displayName: cleanName,
      };
      accounts.push(newAccount);
      localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(accounts));
      localStorage.setItem(
        LOCAL_SESSION_KEY,
        JSON.stringify({
          uid: newAccount.uid,
          email: newAccount.email,
          displayName: newAccount.displayName,
        })
      );

      const localToken = createLocalToken(newAccount);
      await syncWithBackend(localToken, cleanName);
    } catch (err: unknown) {
      const msg = formatFirebaseAuthError(err, 'Registration failed');
      error.value = msg;
      throw new Error(msg);
    } finally {
      loading.value = false;
    }
  }

  async function login(idOrEmail: string, password: string): Promise<void> {
    error.value = null;
    loading.value = true;
    const email = normalizeEmailId(idOrEmail);

    try {
      if (isFirebaseConfigured && firebaseAuth) {
        const credential = await signInWithEmailAndPassword(
          firebaseAuth,
          email,
          password
        );
        const idToken = await credential.user.getIdToken();
        await syncWithBackend(
          idToken,
          credential.user.displayName || undefined
        );
        await syncUserToFirestore(
          credential.user,
          credential.user.displayName || undefined
        ).catch((err) => {
          console.warn('Firestore profile sync skipped:', err);
        });
        return;
      }

      if (password.length < 6) {
        throw new Error('Invalid ID/Email or password');
      }

      const rawAccounts = localStorage.getItem(LOCAL_ACCOUNTS_KEY);
      const accounts: LocalStoredAccount[] = rawAccounts
        ? JSON.parse(rawAccounts)
        : [];

      let account = accounts.find((a) => a.email === email);
      if (account && account.password !== password) {
        throw new Error('Incorrect password for this account');
      }

      if (!account) {
        account = {
          uid: `fb_${email.replace(/[^a-z0-9]/g, '_')}`,
          email,
          password,
          displayName: email.split('@')[0],
        };
        accounts.push(account);
        localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(accounts));
      }

      localStorage.setItem(
        LOCAL_SESSION_KEY,
        JSON.stringify({
          uid: account.uid,
          email: account.email,
          displayName: account.displayName,
        })
      );

      const localToken = createLocalToken(account);
      await syncWithBackend(localToken, account.displayName);
    } catch (err: unknown) {
      const msg = formatFirebaseAuthError(err, 'Login failed');
      error.value = msg;
      throw new Error(msg);
    } finally {
      loading.value = false;
    }
  }

  async function loginWithGoogle(): Promise<void> {
    if (!isFirebaseConfigured || !firebaseAuth) {
      throw new Error('Firebase is not configured for Google sign-in.');
    }

    error.value = null;
    loading.value = true;
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(firebaseAuth, provider);
      const idToken = await credential.user.getIdToken();
      await syncWithBackend(
        idToken,
        credential.user.displayName || undefined
      );
      await syncUserToFirestore(
        credential.user,
        credential.user.displayName || undefined
      ).catch((err) => {
        console.warn('Firestore profile sync skipped:', err);
      });
    } catch (err: unknown) {
      const msg = formatFirebaseAuthError(err, 'Google sign-in failed');
      error.value = msg;
      throw new Error(msg);
    } finally {
      loading.value = false;
    }
  }

  async function logout(): Promise<void> {
    if (isFirebaseConfigured && firebaseAuth) {
      await signOut(firebaseAuth);
    }
    localStorage.removeItem(LOCAL_SESSION_KEY);
    user.value = null;
    token.value = null;
  }

  return {
    user,
    token,
    loading,
    error,
    isAuthenticated,
    initializeAuth,
    register,
    login,
    loginWithGoogle,
    logout,
  };
});
