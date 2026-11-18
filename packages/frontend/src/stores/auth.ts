import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { firebaseAuth, isFirebaseConfigured } from '../firebase';
import type { UserProfile } from '../types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

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
        uid: `fb_${ email.replace(/[^a-z0-9]/g, '_') }`,
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
      const msg = err instanceof Error ? err.message : 'Registration failed';
      error.value = msg;
      throw err;
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
        // If logging in from a different browser tab or fresh localStorage against an existing DB user
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
      const msg = err instanceof Error ? err.message : 'Login failed';
      error.value = msg;
      throw err;
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
    logout,
  };
});
