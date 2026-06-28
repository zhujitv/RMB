ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "geo_country" TEXT;
ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "geo_region" TEXT;
ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "geo_city" TEXT;
ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "geo_isp" TEXT;
ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "geo_source" TEXT;
ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "geo_resolved_at" TIMESTAMP(3);
