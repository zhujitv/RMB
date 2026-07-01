CREATE TABLE IF NOT EXISTS "api_performance_logs" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'server',
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status_code" INTEGER,
  "duration_ms" INTEGER NOT NULL,
  "user_id" TEXT,
  "role" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "api_performance_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "api_performance_logs_created_at_idx" ON "api_performance_logs"("created_at");
CREATE INDEX IF NOT EXISTS "api_performance_logs_path_created_at_idx" ON "api_performance_logs"("path", "created_at");
CREATE INDEX IF NOT EXISTS "api_performance_logs_duration_ms_idx" ON "api_performance_logs"("duration_ms");
CREATE INDEX IF NOT EXISTS "api_performance_logs_source_created_at_idx" ON "api_performance_logs"("source", "created_at");
CREATE INDEX IF NOT EXISTS "api_performance_logs_status_code_created_at_idx" ON "api_performance_logs"("status_code", "created_at");
