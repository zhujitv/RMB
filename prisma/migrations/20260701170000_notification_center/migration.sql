-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "editable" BOOLEAN NOT NULL DEFAULT true,
    "supports_attachments" BOOLEAN NOT NULL DEFAULT false,
    "security_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "subject_template" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "variables" JSONB,
    "recipient_config" JSONB,
    "cc_emails" JSONB,
    "cc_admin_emails" BOOLEAN NOT NULL DEFAULT false,
    "extra_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "template_id" TEXT,
    "idempotency_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recipient_emails" JSONB NOT NULL,
    "cc_emails" JSONB,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "context" JSONB,
    "related_entity_type" TEXT,
    "related_entity_id" TEXT,
    "related_order_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery_logs" (
    "id" TEXT NOT NULL,
    "outbox_id" TEXT,
    "template_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipient_emails" JSONB NOT NULL,
    "cc_emails" JSONB,
    "subject" TEXT NOT NULL,
    "body_preview" TEXT,
    "related_entity_type" TEXT,
    "related_entity_id" TEXT,
    "related_order_id" TEXT,
    "error_message" TEXT,
    "provider" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_type_key" ON "notification_templates"("type");

-- CreateIndex
CREATE INDEX "notification_templates_module_idx" ON "notification_templates"("module");

-- CreateIndex
CREATE INDEX "notification_templates_enabled_idx" ON "notification_templates"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_idempotency_key_key" ON "notification_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_outbox_type_idx" ON "notification_outbox"("type");

-- CreateIndex
CREATE INDEX "notification_outbox_template_id_idx" ON "notification_outbox"("template_id");

-- CreateIndex
CREATE INDEX "notification_outbox_status_idx" ON "notification_outbox"("status");

-- CreateIndex
CREATE INDEX "notification_outbox_related_order_id_idx" ON "notification_outbox"("related_order_id");

-- CreateIndex
CREATE INDEX "notification_outbox_related_entity_type_related_entity_id_idx" ON "notification_outbox"("related_entity_type", "related_entity_id");

-- CreateIndex
CREATE INDEX "notification_outbox_scheduled_at_idx" ON "notification_outbox"("scheduled_at");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_outbox_id_idx" ON "notification_delivery_logs"("outbox_id");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_template_id_idx" ON "notification_delivery_logs"("template_id");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_type_idx" ON "notification_delivery_logs"("type");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_status_idx" ON "notification_delivery_logs"("status");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_related_order_id_idx" ON "notification_delivery_logs"("related_order_id");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_related_entity_type_related_entity_id_idx" ON "notification_delivery_logs"("related_entity_type", "related_entity_id");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_sent_at_idx" ON "notification_delivery_logs"("sent_at");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_created_at_idx" ON "notification_delivery_logs"("created_at");

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery_logs" ADD CONSTRAINT "notification_delivery_logs_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "notification_outbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery_logs" ADD CONSTRAINT "notification_delivery_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
