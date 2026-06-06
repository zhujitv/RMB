UPDATE "users"
SET
  "is_active" = false,
  "approval_status" = 'DISABLED',
  "must_change_password" = true,
  "updated_at" = CURRENT_TIMESTAMP
WHERE lower("email") = 'admin@example.com';

UPDATE "user_sessions"
SET "revoked_at" = CURRENT_TIMESTAMP
WHERE "user_id" IN (
  SELECT "id"
  FROM "users"
  WHERE lower("email") = 'admin@example.com'
)
AND "revoked_at" IS NULL;
