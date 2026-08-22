-- The legacy logistics mini-program was retired. Remove its persisted sessions,
-- bindings, subscription grants and delivery history in dependency order.
DROP TABLE IF EXISTS "wechat_mini_deliveries";
DROP TABLE IF EXISTS "wechat_mini_subscription_grants";
DROP TABLE IF EXISTS "wechat_mini_sessions";
DROP TABLE IF EXISTS "wechat_mini_bindings";
