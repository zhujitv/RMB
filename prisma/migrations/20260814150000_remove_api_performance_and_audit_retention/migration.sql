-- 后台性能任务功能已停用，删除其全部历史数据和存储表。
DROP TABLE IF EXISTS "api_performance_logs";

-- 系统操作日志仅保留最近 30 天；后续由每日系统维护任务持续清理。
DELETE FROM "audit_logs"
WHERE "created_at" < CURRENT_TIMESTAMP - INTERVAL '30 days';
