# Azure PostgreSQL + Blob + Queue Setup Guide

This guide walks you through migrating SmartHRMS from local MongoDB to **Azure Database for PostgreSQL + Azure Blob Storage + Azure Queue Storage**, while keeping the existing app running until you're ready to switch.

---

## What's already done (in the codebase)

✅ Prisma ORM installed (`@prisma/client` v6)
✅ PostgreSQL schema generated for all 8 models — see `prisma/schema.prisma`
✅ Azure Blob Storage service — `src/services/azureBlobService.ts`
✅ Azure Queue Storage service — `src/services/azureQueueService.ts`
✅ MongoDB → PostgreSQL data migration script — `scripts/migrate-mongo-to-pg.ts`
✅ Prisma client singleton — `src/lib/prisma.ts`
✅ Server boot wired up (Blob/Queue init are no-ops if env vars aren't set)
✅ Existing Mongoose code is **untouched** — current app still works

---

## What you need to do

### Step 1 — Create Azure Database for PostgreSQL

1. [portal.azure.com](https://portal.azure.com) → **Create a resource** → search **"Azure Database for PostgreSQL"**
2. Pick **Flexible Server** (recommended)
3. Settings:
   - Server name: `smarthrms-pg`
   - PostgreSQL version: **16**
   - Compute + storage: **Burstable B1ms** (cheapest, ~$13/mo)
   - Admin username: `hrmsadmin`
   - Password: (save it)
4. **Networking** tab → Allow access from your IP **and** check "Allow public access from Azure services"
5. Create → wait ~5 mins
6. Copy connection details and build the URL:
   ```
   postgresql://<db_user>:<db_password>@<your-server>.postgres.database.azure.com:5432/postgres?sslmode=require
   ```

### Step 2 — Create Azure Storage Account (for Blob + Queue)

1. **Create a resource** → **"Storage account"**
2. Settings:
   - Name: `smarthrmsstorage` (must be globally unique, lowercase)
   - Performance: **Standard**
   - Redundancy: **LRS** (cheapest)
3. Create → ~2 mins
4. Storage account → **Access keys** → copy **Connection string** (key1)

### Step 3 — Update `backend/.env`

Add these lines:

```env
# Switch this to "postgres" once migration is complete
DB_PROVIDER=mongo

# Azure PostgreSQL
DATABASE_URL=postgresql://<db_user>:<db_password>@<your-server>.postgres.database.azure.com:5432/postgres?sslmode=require

# Azure Storage (Blob + Queue share the same connection string)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net
AZURE_BLOB_CONTAINER_NAME=hrms-files
AZURE_QUEUE_NAME=hrms-jobs
```

### Step 4 — Run Prisma migrations (creates the SQL tables)

```bash
cd backend
npx prisma migrate deploy
```

This reads `prisma/schema.prisma` and creates all 8 tables in your Azure PostgreSQL.

### Step 5 — Migrate existing data from MongoDB to PostgreSQL

```bash
cd backend
npm run db:migrate-from-mongo
```

This copies all your users, employees, attendance logs, devices, leaves, WFH requests, shifts, and settings.

### Step 6 — Verify

```bash
npx prisma studio
```

Opens a browser at `http://localhost:5555` — you can browse all your tables visually. Confirm rows are present.

### Step 7 — Switch the app to PostgreSQL

In `backend/.env`, change:
```env
DB_PROVIDER=postgres
```

Then restart the backend. (Note: requires the route migration to be completed — see "Future Work" below.)

---

## Future Work — Routes migration

The backend currently uses Mongoose for all routes/services. Switching `DB_PROVIDER=postgres` requires rewriting:

- `src/routes/*.ts` — all 8 route files
- `src/services/esslService.ts`, `etlService.ts`, `cronService.ts`
- `src/middleware/auth.ts`

**Estimated effort:** 2-3 days. Each Mongoose query (`Model.find()`, `populate()`, `aggregate()`) maps to a Prisma equivalent.

When ready, ask Copilot to "Migrate route X from Mongoose to Prisma" — it's mechanical work that can be done incrementally route by route while the app keeps running.

---

## Cost Estimate (per month)

| Service | Tier | Cost |
|---|---|---|
| PostgreSQL Flexible Server | Burstable B1ms (1 vCore, 2GB RAM) | ~$13 |
| Storage Account (Blob + Queue) | Standard LRS, low usage | ~$1 |
| **Total** | | **~$14/mo** |

---

## Rollback

If anything goes wrong, just set `DB_PROVIDER=mongo` in `.env` and restart. Your MongoDB data is untouched.
