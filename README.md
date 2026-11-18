# Shared To-Do List — Full-Stack Monorepo

An end-to-end containerized **Shared To-Do List** application built as a TypeScript Monorepo with **Vue 3 + Pinia + Vite**, **Node.js / Fastify (Serverless Functions)**, **PostgreSQL**, **Firebase Authentication**, and **Docker Compose**.

---

## 📁 Monorepo Structure

```text
.
├── docker-compose.yml              # Container orchestration (Frontend, Backend, PostgreSQL)
├── schema.dbml                     # DBML database schema definition
├── .env.example                    # Root environment variable template
├── package.json                    # NPM Workspaces root configuration
├── tsconfig.base.json              # Shared TypeScript configuration
└── packages/
    ├── backend/                    # Node.js + Fastify (Serverless) + TypeScript + PostgreSQL
    │   ├── Dockerfile
    │   ├── serverless.yml          # AWS Lambda / Serverless deployment manifest
    │   ├── .env.example
    │   ├── sql/
    │   │   └── init.sql            # PostgreSQL schema initialization
    │   └── src/
    │       ├── app.ts              # Fastify app builder
    │       ├── auth.ts             # Firebase ID token verification & DB user provisioning
    │       ├── db.ts               # PostgreSQL pool & schema initialization
    │       ├── lambda.ts           # @fastify/aws-lambda serverless handler export
    │       ├── server.ts           # Local / Docker server entrypoint
    │       └── functions/
    │           ├── auth.ts         # Login/Signup DB sync & user directory endpoints
    │           └── tasks.ts        # Task CRUD & task sharing endpoints
    └── frontend/                   # Vue 3 + Pinia + Vite + TypeScript + Firebase Auth
        ├── Dockerfile
        ├── nginx.conf
        ├── .env.example
        └── src/
            ├── firebase.ts         # Firebase Auth client setup (with local fallback mode)
            ├── stores/
            │   ├── auth.ts         # Pinia store for Login/Signup & backend user sync
            │   └── tasks.ts        # Pinia store for Task CRUD, filtering, and sharing
            └── components/
                ├── AuthView.vue        # ID/Email + Password Login & User Creation UI
                ├── TaskBoard.vue       # Tasks tab, dropdown filter (All/My/Shared), CRUD UI
                └── ShareTaskModal.vue  # Popup modal to share tasks with other users
```

---

## 🗄 Database Schema (`schema.dbml`)

The database schema is documented in [`schema.dbml`](./schema.dbml) and automatically provisioned via [`packages/backend/sql/init.sql`](./packages/backend/sql/init.sql):

- **`users`**: Stores registered users (`id`, `firebase_uid`, `email`, `display_name`, `created_at`, `updated_at`).
- **`tasks`**: Stores to-do items (`id`, `title`, `description`, `completed`, `owner_id`, `created_at`, `updated_at`).
- **`task_shares`**: Join table granting other users access to specific tasks (`id`, `task_id`, `shared_with_user_id`, `shared_by_user_id`, `created_at`).

---

## ⚙️ Environment Variables

Copy the example environment files before running:

```bash
cp .env.example .env
cp packages/backend/.env.example packages/backend/.env
cp packages/frontend/.env.example packages/frontend/.env
```

| Variable | Description | Default |
| --- | --- | --- |
| `POSTGRES_USER` | PostgreSQL username | `postgres` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `postgres` |
| `POSTGRES_DB` | PostgreSQL database name | `shared_todo` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/shared_todo` |
| `BACKEND_PORT` | Fastify backend port | `3001` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:5173` |
| `FIREBASE_PROJECT_ID` | Firebase project ID (Admin SDK) | *(optional in local dev mode)* |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email | *(optional in local dev mode)* |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key | *(optional in local dev mode)* |
| `VITE_API_BASE_URL` | Backend API base URL | `http://localhost:3001/api` |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key | *(optional in local dev mode)* |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain | *(optional in local dev mode)* |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Project ID | *(optional in local dev mode)* |

> **Note on Firebase Authentication**:
> When valid Firebase credentials are provided in `.env`, the app uses live Firebase Authentication (`firebase/auth` on the frontend and `firebase-admin` on the backend). If left at their default placeholder values, the app automatically activates a built-in Firebase-compatible local authentication mode so you can immediately register multiple users, sign in with ID/Email + Password, and test task sharing out of the box.

---

## 🐳 Running with Docker Compose (Recommended)

Build and start the PostgreSQL database, Fastify backend, and Vue frontend containers:

```bash
docker compose up --build
```

- **Frontend UI**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:3001/api/health](http://localhost:3001/api/health)
- **PostgreSQL**: `localhost:5432`

To stop the containers:

```bash
docker compose down
```

---

## 💻 Running in Local Development Environment

### Prerequisites
- **Node.js** `>= 18.x` and **npm** `>= 9.x`
- **PostgreSQL** `>= 14.x` running locally (or start only the DB container via `docker compose up -d db`)

### 1. Install Dependencies
From the monorepo root:

```bash
npm install
```

### 2. Configure Environment Variables
```bash
cp .env.example .env
cp packages/backend/.env.example packages/backend/.env
cp packages/frontend/.env.example packages/frontend/.env
```

### 3. Start PostgreSQL Database
If you don't have a local Postgres instance running on port `5432`, you can spin up the database container alone:

```bash
docker compose up -d db
```
*(The backend also automatically runs `CREATE TABLE IF NOT EXISTS` migrations on startup.)*

### 4. Start the Backend & Frontend Development Servers
Run both servers in separate terminals from the root directory:

**Terminal 1 — Backend (Fastify on port 3001):**
```bash
npm run dev:backend
```

**Terminal 2 — Frontend (Vite + Vue 3 on port 5173):**
```bash
npm run dev:frontend
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🔌 Backend API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/auth/sync` | Verifies Firebase/Bearer token and creates/updates the user in PostgreSQL |
| `GET` | `/api/users` | Lists registered users available for task sharing |
| `GET` | `/api/tasks?filter=all\|my\|shared` | Lists tasks created by or shared with the authenticated user |
| `POST` | `/api/tasks` | Creates a new task |
| `PUT` | `/api/tasks/:id` | Updates a task's title, description, or completion status |
| `DELETE` | `/api/tasks/:id` | Deletes a task (owner only) |
| `POST` | `/api/tasks/:id/share` | Shares a task with another user by Email or User ID |
| `DELETE` | `/api/tasks/:id/share/:targetUserId` | Removes a user's shared access to a task |
