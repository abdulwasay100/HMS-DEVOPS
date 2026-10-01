# Hotel Management System

A medium-sized hotel management web application: rooms, bookings, restaurant orders, inventory with automatic stock deduction, billing/receipts, reports, customers and role-based access.

| Layer    | Technology                                            |
| -------- | ----------------------------------------------------- |
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS      |
| Backend  | Node.js + Express 5 REST API (TypeScript)             |
| Database | MySQL 8                                               |

The frontend and backend are fully separate apps that talk over HTTP, so each can be containerised and deployed on its own later.

## Project layout

```
HMS-DEVOPS/
├── backend/
│   ├── migrations/          # Plain SQL migrations (001_init.sql, ...)
│   ├── scripts/smoke-test.ts
│   └── src/
│       ├── config/          # Env parsing/validation
│       ├── db/              # Pool, migrate, seed, demo seed
│       ├── middleware/      # Auth, error handler
│       ├── modules/         # auth, users, rooms, customers, bookings, menu,
│       │                    # inventory, orders, billing, reports, dashboard
│       ├── utils/
│       ├── app.ts
│       └── server.ts
└── frontend/
    └── src/
        ├── app/             # Routes (login + (app) route group)
        ├── components/      # ui/, layout/, forms/
        ├── context/         # Auth, config, toast providers
        ├── hooks/
        └── lib/             # API client, types, formatting, validation
```

## Prerequisites

- Node.js 20 or newer
- MySQL 8 (local install, or any reachable server)

## 1. Create the database

Run this in a MySQL client as a privileged user (choose your own password):

```sql
CREATE DATABASE hms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hms_user'@'localhost' IDENTIFIED BY '<choose-a-strong-password>';
GRANT ALL PRIVILEGES ON hms.* TO 'hms_user'@'localhost';
FLUSH PRIVILEGES;
```

## 2. Run the backend

```bash
cd backend
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```

Edit `backend/.env`:

- `DB_USER`, `DB_PASSWORD`, `DB_NAME` (and `DB_HOST`/`DB_PORT`) to match step 1. Alternatively set a single `DATABASE_URL`.
- `JWT_SECRET` to a long random value:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

- Optionally `HOTEL_*`, `CURRENCY`, `TAX_RATE_PERCENT`, `SEED_ADMIN_EMAIL`.

Then:

```bash
npm install
npm run db:setup      # applies migrations and creates the first admin
npm run seed:demo     # optional: sample rooms, inventory and menu (no users)
npm run dev           # http://localhost:4000
```

`npm run db:setup` prints the first admin's email and password **once**. If you leave `SEED_ADMIN_PASSWORD` blank a random password is generated; copy it from the console. Health check: `http://localhost:4000/health`.

## 3. Run the frontend

```bash
cd frontend
cp .env.example .env.local    # Windows PowerShell: Copy-Item .env.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

`NEXT_PUBLIC_API_URL` (default `http://localhost:4000`) must point to the backend, and the backend's `CORS_ORIGIN` must include the frontend URL.

Open http://localhost:3000 and sign in with the admin credentials from step 2. Create Manager and Staff users under **Staff & Users**.

## Production-style run

```bash
# backend
cd backend && npm run build && npm run migrate:prod && npm start

# frontend (NEXT_PUBLIC_API_URL is baked in at build time)
cd frontend && npm run build && npm start
```

## Roles and permissions

| Area                                              | Staff | Manager | Admin |
| ------------------------------------------------- | :---: | :-----: | :---: |
| Dashboard                                         |  yes  |   yes   |  yes  |
| Rooms: view, change status                        |  yes  |   yes   |  yes  |
| Rooms: add / edit / delete                        |       |   yes   |  yes  |
| Bookings, customers (create/edit), food orders    |  yes  |   yes   |  yes  |
| Customers: delete                                 |       |   yes   |  yes  |
| Menu: view, toggle availability                   |  yes  |   yes   |  yes  |
| Menu and categories: add / edit / delete          |       |   yes   |  yes  |
| Inventory: view                                   |  yes  |   yes   |  yes  |
| Inventory: add / edit / adjust stock              |       |   yes   |  yes  |
| Billing: create bills, record payments, receipts  |  yes  |   yes   |  yes  |
| Billing: delete unpaid bill                       |       |   yes   |  yes  |
| Reports                                           |       |   yes   |  yes  |
| Users                                             |       |         |  yes  |

Permissions are enforced by the API; the UI only hides what a role cannot use. The user record is reloaded on every request, so deactivating a user or changing a role takes effect immediately.

## Business rules

- **Double-booking prevention.** Creating or editing a booking locks the room row and rejects any overlap with another Reserved/Checked-In booking (check-out day is free for the next guest).
- **Orders.** Multi-item orders with subtotal, discount, tax and total. Statuses: Pending, Preparing, Completed, Cancelled. Completed and Cancelled are final.
- **Automatic inventory deduction.** Each menu item has a recipe (ingredients and quantities). When an order becomes **Completed**, all required stock is deducted in one transaction and logged as `Order Usage`. If any ingredient is short, the completion is rejected and nothing changes. The response lists ingredients that fell to or below their minimum, and the UI shows a low-stock warning.
- **Billing.** A bill combines a booking's room charges with itemised food from completed, not-yet-billed orders (walk-in bills for orders without a customer are supported). Discount is applied before tax. Payment status is derived from the amount paid: Unpaid, Partial or Paid. A booking or order can only be on one bill.
- **Tax.** Set with `TAX_RATE_PERCENT`; the rate used is stored on each order and bill so history does not change if the rate changes.
- **Sales figures** (dashboard and reports) are based on bills: "billed" is the grand total, "collected" is the amount paid. "Today" uses the server's timezone.

## Configuration reference

All configuration is via environment variables; nothing is hardcoded.

Backend (`backend/.env.example`): `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `DATABASE_URL` or `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`, `DB_SOCKET_PATH`, `DB_CONNECTION_LIMIT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `HOTEL_NAME`/`ADDRESS`/`PHONE`/`EMAIL`, `CURRENCY`, `TAX_RATE_PERCENT`, `SEED_ADMIN_*`.

Frontend (`frontend/.env.example`): `NEXT_PUBLIC_API_URL`.

Real `.env` files are git-ignored; only the `.env.example` templates are committed.

## Database migrations

SQL files in `backend/migrations` are applied in filename order and recorded in a `schema_migrations` table, guarded by a MySQL advisory lock so concurrent starts are safe. Add a new numbered file (for example `002_add_something.sql`) for schema changes; never edit an applied migration.

## Smoke test (development databases only)

With the backend running against a **throwaway** database (the test creates real records):

```bash
cd backend
API_URL=http://localhost:4000 SMOKE_EMAIL=<admin-email> SMOKE_PASSWORD=<admin-password> npm run smoke
```

PowerShell:

```powershell
$env:API_URL="http://localhost:4000"; $env:SMOKE_EMAIL="<admin-email>"; $env:SMOKE_PASSWORD="<admin-password>"; npm run smoke
```

## Ready for containers and cloud (not included yet)

The app is structured so containerisation and cloud deployment can be added without code changes:

- Frontend and backend build independently (`.next` and `dist/`), each with its own `package.json`.
- MySQL is external and configured only through env vars; a Unix socket (`DB_SOCKET_PATH`) is supported for Cloud SQL.
- The backend honours `PORT` and trusts one proxy hop, as expected behind a load balancer.
- `/health` (liveness) and `/health/ready` (checks the database) suit container health checks.
- `migrate:prod` and `seed:prod` run from the compiled output, so a release step or job can migrate without dev dependencies.
- `NEXT_PUBLIC_API_URL` is a build-time value for the frontend image; `CORS_ORIGIN` is a runtime value for the backend.
- Secrets (`JWT_SECRET`, DB credentials) are only read from the environment, ready for a secret manager.

No Docker, Terraform, Kubernetes or CI files are included at this stage.
