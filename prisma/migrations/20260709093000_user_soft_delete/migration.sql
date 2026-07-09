ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");
