CREATE TABLE IF NOT EXISTS "company_hs" (
  "id" TEXT NOT NULL,
  "hs_code" TEXT NOT NULL,
  "cn_name" TEXT NOT NULL,
  "en_name" TEXT,
  "unit" TEXT NOT NULL,
  "rebate_rate" DECIMAL(8,4) NOT NULL,
  "vat_rate" DECIMAL(8,4) NOT NULL DEFAULT 0.13,
  "keywords" TEXT,
  "remark" TEXT,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "company_hs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_hs_hs_code_key" ON "company_hs"("hs_code");
CREATE INDEX IF NOT EXISTS "company_hs_hs_code_idx" ON "company_hs"("hs_code");
CREATE INDEX IF NOT EXISTS "company_hs_cn_name_idx" ON "company_hs"("cn_name");
CREATE INDEX IF NOT EXISTS "company_hs_en_name_idx" ON "company_hs"("en_name");
CREATE INDEX IF NOT EXISTS "company_hs_is_enabled_idx" ON "company_hs"("is_enabled");
CREATE INDEX IF NOT EXISTS "company_hs_deleted_at_idx" ON "company_hs"("deleted_at");
