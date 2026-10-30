# SmartHRMS

A full-stack Human Resource Management System with attendance tracking, leave management, and eSSL biometric device integration.

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, Recharts, Socket.IO Client |
| **Backend** | Node.js, Express, TypeScript, Prisma ORM, Socket.IO |
| **Database** | PostgreSQL (Azure Database for PostgreSQL) |
| **Auth** | JWT (local) + Azure AD / MSAL (SSO) |
| **Cloud** | Azure Blob Storage, Azure Queue Storage |
| **eSSL Integration** | Direct iClock/eTimeTrackLite protocol via cron-based sync |

---

## Architecture — Data Flow

```
┌─────────────┐        ┌──────────────┐        ┌──────────────┐
│  Frontend   │──API──▶│   Backend    │──────▶  │  PostgreSQL  │
│  (Vite SPA) │        │  (Express)   │         │   (Prisma)   │
└─────────────┘        └──────┬───────┘         └──────────────┘
                              │
               Cron (every 1 min) + ESSL Live page only
                              │
                              ▼
                       ┌──────────────┐
                       │ eSSL Device  │
                       │ (biometric)  │
                       └──────────────┘
```

**Key principle:** All pages read from PostgreSQL. The cron job syncs punch data from eSSL devices into `rawPunchLog` every minute. Only the **ESSL Live** page fetches directly from the biometric hardware for real-time data.

| Page | Data Source |
|---|---|
| Dashboard | PostgreSQL (`rawPunchLog`) |
| Attendance | PostgreSQL (`attendanceLog`) |
| Calendar | PostgreSQL (`rawPunchLog`) |
| ESSL Live | **eSSL Device direct** (real-time) |
| ESSL Control | PostgreSQL + eSSL Device (machine management) |
| Leaves / Approvals | PostgreSQL |
| Employees | PostgreSQL |
| Devices | PostgreSQL |
| Reports | PostgreSQL |
| Settings | PostgreSQL |

---

## Project Structure

```
/
├── frontend/          # React + Vite SPA
├── backend/           # Express API server
│   ├── src/
│   │   ├── routes/    # API route handlers
│   │   ├── services/  # Business logic & integrations
│   │   └── middleware/
│   ├── prisma/        # Database schema & migrations
│   └── scripts/       # DB migration & seed utilities
└── agents/            # AI agent prompt templates
```

---

## Prerequisites

- Node.js 18+
- PostgreSQL database (local or Azure)
- (Optional) Azure Storage account for file uploads & queuing
- (Optional) eSSL eTimeTrackLite server for biometric attendance

---

## Getting Started

### 1. Clone & install dependencies

```bash
git clone <repo-url>
cd <repo>
npm run install:all
```

### 2. Configure environment variables

**`backend/.env`**
```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require

# Auth
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

# App
PORT=5000
FRONTEND_URL=http://localhost:5173

# Email (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=your_password
EMAIL_FROM=noreply@example.com

# Azure Storage (optional)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;...
AZURE_BLOB_CONTAINER=hrms-files
AZURE_QUEUE_NAME=hrms-jobs

# Azure AD / SSO (optional)
AZURE_AD_TENANT_ID=your_tenant_id
AZURE_AD_CLIENT_ID=your_client_id
AZURE_AD_CLIENT_SECRET=your_client_secret
```

### 3. Run database migrations

```bash
cd backend
npm run prisma:migrate   # dev environment
# or
npm run prisma:deploy    # production
npm run prisma:generate
```

### 4. (Optional) Seed demo data

```bash
cd backend
npx ts-node scripts/seed-demo.ts
```

### 5. Start the development servers

```bash
# From project root — starts backend (port 5001) and frontend (port 5173) together
npm run dev
```

Or start individually:

```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev
```

---

## eSSL Biometric Integration

The backend communicates directly with eSSL eTimeTrackLite devices — no separate proxy needed.

**How it works:**
1. **Cron job** runs every minute, checks which devices are due for sync (per device `syncInterval`)
2. Fetches new punch records via iClock protocol or portal scraping
3. Inserts into `rawPunchLog` table (with deduplication)
4. Processes into `attendanceLog` (first-in / last-out per employee per day)
5. Emits Socket.IO event so connected dashboards refresh automatically

**Device management** (ESSL Control page) still talks to the physical device for operations like adding/removing employees on the biometric hardware.

Configure devices via the **Devices** page in the app — provide the device IP, port, serial number, and eTimeTrackLite credentials.

---

## Available Scripts

### Root
| Script | Description |
|---|---|
| `npm run dev` | Start backend + frontend concurrently |
| `npm run build` | Build both backend and frontend |
| `npm run install:all` | Install all dependencies |

### Backend (`cd backend`)
| Script | Description |
|---|---|
| `npm run dev` | Start with ts-node-dev (hot reload) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run prisma:studio` | Open Prisma Studio (DB GUI) |
| `npm run prisma:migrate` | Create & apply a new migration |
| `npm run db:migrate-from-mongo` | One-time MongoDB → PostgreSQL import |

---

## Features

- **Authentication** — JWT with refresh tokens, email verification, password reset, Azure AD SSO
- **Employee Management** — Profiles, departments, roles (Admin / HR / Manager / Employee)
- **Attendance** — Clock-in/out, real-time updates via WebSocket, eSSL biometric auto-sync (every minute)
- **Leave Management** — Leave requests, approvals, leave balance tracking
- **WFH Requests** — Work-from-home request & approval workflow
- **Reports** — Attendance and leave reports, CSV/PDF export
- **Devices** — Manage eSSL biometric readers, auto-sync configuration
- **ESSL Live** — Real-time punch feed direct from biometric hardware
- **ESSL Control** — Machine-level employee management (add/edit/remove on device)
- **Notifications** — Email notifications via Nodemailer, Socket.IO real-time updates

---

## Deployment

The project is configured for deployment on **Azure** (App Service + Static Web Apps) and **Vercel** (serverless). See [backend/AZURE_SETUP.md](backend/AZURE_SETUP.md) for the full Azure provisioning guide.

---

## Roles & Permissions

| Role | Capabilities |
|---|---|
| `Admin` | Full access to all modules and settings |
| `HR` | Manage employees, approve leaves, view reports |
| `Manager` | Approve team leaves & WFH, view team attendance |
| `Employee` | View own profile, submit leave/WFH requests |
