UPDATE "order_costs"
SET "cost_type" = '拖车费'
WHERE "cost_type" IN ('国内物流费', '国内拖车费');

UPDATE "order_costs"
SET "cost_type" = '港杂费'
WHERE "cost_type" IN ('文件费', '订舱费');
