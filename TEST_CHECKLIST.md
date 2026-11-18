# Test Checklist & Execution Guide

## 1. Automated Tests Included in Repo
Run from the repository root:

```bash
# 1. Build frontend (vue-tsc + vite) & backend (tsc)
npm run build

# 2. Run Backend Auth & Task CRUD / Sharing integration tests
npm test

# 3. Lint Firestore Security Rules
npx eslint firestore.rules
```

### Covered Test Cases (`packages/backend/test/api.test.ts`)
1. `GET /api/health` returns `200 OK` and service metadata.
2. Unauthenticated requests to `/api/tasks` return `401 Unauthorized`.
3. Invalid Firebase Bearer tokens on `/api/tasks` and `/api/auth/sync` return `401 Unauthorized`.
4. `POST /api/auth/sync` creates/updates multiple user profiles (Alice, Bob, Charlie).
5. `GET /api/users` lists other registered users while excluding the authenticated caller.
6. `POST /api/tasks` rejects empty titles (`400`) and creates tasks (`201`).
7. `POST /api/tasks/:id/share` shares a task with another registered user by email, rejects sharing with the task owner (`400`), and returns `404` for unregistered users.
8. `GET /api/tasks?filter=all|my|shared` returns the right tasks for owners, collaborators, and unrelated users.
9. `PUT /api/tasks/:id` allows owners and shared collaborators to edit/toggle completion, and rejects unrelated users (`404`).
10. `DELETE /api/tasks/:id` blocks non-owner collaborators (`403`) and permits owners (`200`).
11. `DELETE /api/tasks/:id/share/:targetUserId` revokes collaborator access (`200`).

### Firestore Rules Adversarial Test Matrix (`firestore.rules.test.ts` & `security_spec.md`)
- 12 "Dirty Dozen" attack payloads covering identity spoofing, unverified email writes, shadow field injection, owner hijacking, timestamp forgery, PII blanket reads, lookup scraping, ID poisoning, value poisoning, unauthorized deletion, and orphaned share writes.

---

## 2. Running Playwright E2E + Screenshots From Another Machine

> **Note on URLs:**
> - **Development URL** (`https://ais-dev-enc34wircd54camk26f6z6-662080088853.asia-northeast1.run.app/`) sits behind Google AI Studio's private preview proxy (requires your logged-in Google AI Studio session cookie).
> - **Published URL**: Click **Publish** in AI Studio first, then run Playwright against the published URL (`https://ais-pre-enc34wircd54camk26f6z6-662080088853.asia-northeast1.run.app` or your deployed `.run.app` URL).
> - **Firebase Authorized Domains**: Make sure your published hostname is added under Firebase Console → **Authentication → Settings → Authorized domains** so **Continue with Google** works on that URL.

### Option A: Test with Google Sign-In (`Continue with Google`) — Recommended
Because Google OAuth blocks automated headless typing, capture your Google login session once into `auth.json`, then run the full Playwright suite + screenshots:

```bash
# Step 1: Open browser, click "Continue with Google", finish login, then close browser to save auth.json
npx playwright open --save-storage=auth.json https://ais-pre-enc34wircd54camk26f6z6-662080088853.asia-northeast1.run.app

# Step 2: Run full Task CRUD + Filter + Share Modal tests & capture screenshots
STORAGE_STATE=auth.json \
BASE_URL=https://ais-pre-enc34wircd54camk26f6z6-662080088853.asia-northeast1.run.app \
  npx playwright test e2e/shared-todo.spec.ts
```

### Option B: Test with Email/Password Login
1. Enable **Email/Password** in Firebase Console (`Authentication -> Sign-in method -> Email/Password`).
2. Create a test user or register in the app, then run:

```bash
BASE_URL=https://ais-pre-enc34wircd54camk26f6z6-662080088853.asia-northeast1.run.app \
TEST_EMAIL=your-test-user@example.com \
TEST_PASSWORD=your-password \
  npx playwright test e2e/shared-todo.spec.ts
```

Screenshots generated: `e2e-login.png`, `e2e-signup.png`, `e2e-taskboard.png`, `e2e-share-modal.png`.
