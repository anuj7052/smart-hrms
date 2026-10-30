-- Add eSSL polling config to AppSettings (DB-managed, not editable via app UI)
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "esslEnabled"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "esslMode"      TEXT    NOT NULL DEFAULT 'session';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "esslProxyUrl"  TEXT    NOT NULL DEFAULT 'https://smarthrms-backend-fggdhde8dvfheygd.centralindia-01.azurewebsites.net';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "esslServerUrl" TEXT    NOT NULL DEFAULT '';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "esslUserName"  TEXT    NOT NULL DEFAULT '';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "esslPassword"  TEXT    NOT NULL DEFAULT '';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "esslPollMs"    INTEGER NOT NULL DEFAULT 5000;
