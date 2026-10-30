ALTER TABLE "LeaveType" ADD COLUMN "isUnlimited" BOOLEAN NOT NULL DEFAULT false;

-- Approval-based leave types have no annual allocation or balance limit.
INSERT INTO "LeaveType" ("id", "name", "daysAllowed", "isUnlimited", "description", "updatedAt")
VALUES
  ('lt_event', 'Event Leave', 0, true, 'Leave for attending events. Subject to approval; no fixed annual limit.', CURRENT_TIMESTAMP),
  ('lt_client_visit', 'Client Visit Leave', 0, true, 'Leave for client visits. Subject to approval; no fixed annual limit.', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET
  "isUnlimited" = true,
  "daysAllowed" = 0,
  "isActive" = true,
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;
