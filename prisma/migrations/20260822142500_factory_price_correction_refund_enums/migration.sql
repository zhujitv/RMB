-- Enum values must be committed before later migrations reference them from
-- constraints or PL/pgSQL functions.
BEGIN;

ALTER TYPE "FactoryPurchasePaymentKind" ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE "FactoryPurchaseSettlementStatus" ADD VALUE IF NOT EXISTS 'PENDING_REFUND';

COMMIT;
