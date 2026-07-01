CREATE TABLE IF NOT EXISTS "business_entities" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "short_name" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT '启用',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "business_entities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_entities_name_key" ON "business_entities"("name");
CREATE INDEX IF NOT EXISTS "business_entities_status_idx" ON "business_entities"("status");
CREATE INDEX IF NOT EXISTS "business_entities_is_default_idx" ON "business_entities"("is_default");
CREATE INDEX IF NOT EXISTS "business_entities_deleted_at_idx" ON "business_entities"("deleted_at");
CREATE UNIQUE INDEX IF NOT EXISTS "business_entities_single_default_idx"
  ON "business_entities"("is_default")
  WHERE "is_default" = true AND "deleted_at" IS NULL;

INSERT INTO "business_entities" ("id", "name", "short_name", "is_default", "status", "sort_order", "remark", "updated_at")
VALUES ('default-business-entity', '浙江莱诺建材有限公司', '莱诺建材', true, '启用', 0, '系统默认业务主体', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE
SET "is_default" = true,
    "status" = '启用',
    "updated_at" = CURRENT_TIMESTAMP;

ALTER TABLE "receivable_orders"
  ADD COLUMN IF NOT EXISTS "business_entity_id" TEXT,
  ADD COLUMN IF NOT EXISTS "business_entity_name_snapshot" TEXT;

UPDATE "receivable_orders"
SET "business_entity_id" = COALESCE("business_entity_id", 'default-business-entity'),
    "business_entity_name_snapshot" = COALESCE("business_entity_name_snapshot", '浙江莱诺建材有限公司')
WHERE "deleted_at" IS NULL
  AND ("business_entity_id" IS NULL OR "business_entity_name_snapshot" IS NULL);

CREATE INDEX IF NOT EXISTS "receivable_orders_business_entity_id_idx" ON "receivable_orders"("business_entity_id");
CREATE INDEX IF NOT EXISTS "receivable_orders_business_entity_idx" ON "receivable_orders"("deleted_at", "business_entity_id", "updated_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receivable_orders_business_entity_id_fkey'
  ) THEN
    ALTER TABLE "receivable_orders"
      ADD CONSTRAINT "receivable_orders_business_entity_id_fkey"
      FOREIGN KEY ("business_entity_id")
      REFERENCES "business_entities"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
