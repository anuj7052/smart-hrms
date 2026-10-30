-- Store stable Microsoft Entra identity metadata for SSO account linking.
ALTER TABLE "User"
  ADD COLUMN "entraObjectId" TEXT,
  ADD COLUMN "entraTenantId" TEXT;

CREATE UNIQUE INDEX "User_entraObjectId_key" ON "User"("entraObjectId");
CREATE INDEX "User_entraTenantId_idx" ON "User"("entraTenantId");