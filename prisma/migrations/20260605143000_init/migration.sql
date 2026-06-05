CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "invoiceNo" TEXT,
  "orderNo" TEXT NOT NULL,
  "blNo" TEXT,
  "salesperson" TEXT,
  "customer" TEXT NOT NULL,
  "country" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "amount" DECIMAL(18,2) NOT NULL,
  "rate" DECIMAL(18,6) NOT NULL,
  "creditDays" INTEGER,
  "dueDate" DATE,
  "reminderDays" INTEGER NOT NULL DEFAULT 7,
  "reminderTarget" TEXT NOT NULL DEFAULT '财务和业务员',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Receipt" (
  "id" TEXT NOT NULL,
  "receiptDate" DATE NOT NULL,
  "orderNo" TEXT NOT NULL,
  "customer" TEXT NOT NULL,
  "country" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "amount" DECIMAL(18,2) NOT NULL,
  "rate" DECIMAL(18,6) NOT NULL,
  "status" TEXT NOT NULL DEFAULT '已到账',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Cost" (
  "id" TEXT NOT NULL,
  "costDate" DATE NOT NULL,
  "orderNo" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payee" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "amount" DECIMAL(18,2) NOT NULL,
  "rate" DECIMAL(18,6) NOT NULL,
  "status" TEXT NOT NULL DEFAULT '已支付',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Cost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");
CREATE INDEX "Invoice_orderNo_idx" ON "Invoice"("orderNo");
CREATE INDEX "Invoice_blNo_idx" ON "Invoice"("blNo");
CREATE INDEX "Receipt_receiptDate_idx" ON "Receipt"("receiptDate");
CREATE INDEX "Receipt_orderNo_idx" ON "Receipt"("orderNo");
CREATE INDEX "Cost_costDate_idx" ON "Cost"("costDate");
CREATE INDEX "Cost_orderNo_idx" ON "Cost"("orderNo");
CREATE INDEX "Cost_type_idx" ON "Cost"("type");
