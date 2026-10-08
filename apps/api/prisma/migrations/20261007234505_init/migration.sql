-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'FINANCEIRO', 'LEITURA');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('DRAFT', 'PENDING', 'CONFIRMED', 'PAID', 'OVERDUE', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('SINGLE', 'INSTALLMENT', 'RECURRING');

-- CreateEnum
CREATE TYPE "ChargeOrigin" AS ENUM ('MANUAL', 'CONTRACT', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED');

-- CreateEnum
CREATE TYPE "Cycle" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ChargeRefundKind" AS ENUM ('REFUND', 'CHARGEBACK', 'CHARGEBACK_REVERSAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CANCELED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('ASAAS', 'CONTRACT', 'RECONCILE');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_SIGNED', 'SIGNED', 'REFUSED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('CLIENT', 'COMPANY');

-- CreateEnum
CREATE TYPE "SignerStatus" AS ENUM ('PENDING', 'SIGNED', 'REFUSED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('OPEN', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('CREATED', 'BEFORE_DUE', 'ON_DUE', 'AFTER_DUE', 'MANUAL', 'PAID', 'REFUNDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('ASAAS', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'FINANCEIRO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "company_name" TEXT,
    "company_document" TEXT,
    "company_city" TEXT,
    "default_due_days" INTEGER NOT NULL DEFAULT 3,
    "default_fine_pct" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "default_interest_pct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 3,
    "reminder_on_due_date" BOOLEAN NOT NULL DEFAULT true,
    "reminder_days_after" INTEGER[] DEFAULT ARRAY[1, 7]::INTEGER[],
    "reminder_channels" TEXT[] DEFAULT ARRAY['ASAAS']::TEXT[],
    "contract_charge_due_days" INTEGER NOT NULL DEFAULT 3,
    "company_signer_name" TEXT,
    "company_signer_email" TEXT,
    "company_signer_phone" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "person_type" "PersonType" NOT NULL,
    "document" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" JSONB,
    "asaas_customer_id" TEXT,
    "asaas_sync_error" TEXT,
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contract_id" UUID,
    "subscription_id" UUID,
    "origin" "ChargeOrigin" NOT NULL DEFAULT 'MANUAL',
    "type" "ChargeType" NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'DRAFT',
    "billing_type" "BillingType" NOT NULL,
    "value_cents" INTEGER NOT NULL,
    "net_value_cents" INTEGER,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "fine_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "interest_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "installment_number" INTEGER,
    "installment_count" INTEGER,
    "external_reference" TEXT NOT NULL,
    "group_key" TEXT,
    "asaas_payment_id" TEXT,
    "asaas_installment_id" TEXT,
    "invoice_url" TEXT,
    "bank_slip_url" TEXT,
    "pix_payload" TEXT,
    "identification_field" TEXT,
    "paid_at" DATE,
    "refund_requested_at" TIMESTAMPTZ,
    "last_event_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_refunds" (
    "id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "kind" "ChargeRefundKind" NOT NULL DEFAULT 'REFUND',
    "value_cents" INTEGER NOT NULL,
    "refunded_at" DATE NOT NULL,
    "webhook_event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_items" (
    "id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "service_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,

    CONSTRAINT "charge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contract_id" UUID,
    "asaas_subscription_id" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billing_type" "BillingType" NOT NULL,
    "value_cents" INTEGER NOT NULL,
    "cycle" "Cycle" NOT NULL,
    "next_due_date" DATE NOT NULL,
    "end_date" DATE,
    "description" TEXT NOT NULL,
    "fine_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "interest_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "external_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_items" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "service_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,

    CONSTRAINT "subscription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "source" "EventSource" NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "resource_id" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "result" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'clicksign',
    "provider_template_id" TEXT NOT NULL,
    "variable_map" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" TEXT NOT NULL,
    "provider_envelope_id" TEXT,
    "provider_document_id" TEXT,
    "provider_error" TEXT,
    "provider_progress" JSONB,
    "variables" JSONB NOT NULL,
    "charge_plan" JSONB NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "signed_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "canceled_at" TIMESTAMPTZ,
    "signed_file_key" TEXT,
    "charge_generated_at" TIMESTAMPTZ,
    "charge_error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_signers" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "role" "SignerRole" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "document" TEXT,
    "sign_order" INTEGER NOT NULL DEFAULT 1,
    "auth_method" TEXT NOT NULL DEFAULT 'email',
    "status" "SignerStatus" NOT NULL DEFAULT 'PENDING',
    "provider_signer_id" TEXT,
    "sign_url" TEXT,
    "signed_at" TIMESTAMPTZ,

    CONSTRAINT "contract_signers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_recurrences" (
    "id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "supplier" TEXT,
    "value_cents" INTEGER NOT NULL,
    "day_of_month" INTEGER NOT NULL,
    "start_month" TEXT NOT NULL,
    "end_month" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_generated_for" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expense_recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "supplier" TEXT,
    "value_cents" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'OPEN',
    "paid_at" DATE,
    "paid_value_cents" INTEGER,
    "payment_method" TEXT,
    "recurrence_id" UUID,
    "reference_month" TEXT,
    "notes" TEXT,
    "attachment_key" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_templates" (
    "id" UUID NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "offset_days" INTEGER,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reminder_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_logs" (
    "id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "reference_date" DATE NOT NULL,
    "status" "ReminderStatus" NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_document_key" ON "customers"("document");

-- CreateIndex
CREATE UNIQUE INDEX "customers_asaas_customer_id_key" ON "customers"("asaas_customer_id");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "charges_external_reference_key" ON "charges"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "charges_asaas_payment_id_key" ON "charges"("asaas_payment_id");

-- CreateIndex
CREATE INDEX "charges_status_due_date_idx" ON "charges"("status", "due_date");

-- CreateIndex
CREATE INDEX "charges_customer_id_idx" ON "charges"("customer_id");

-- CreateIndex
CREATE INDEX "charges_asaas_installment_id_idx" ON "charges"("asaas_installment_id");

-- CreateIndex
CREATE INDEX "charges_group_key_idx" ON "charges"("group_key");

-- CreateIndex
CREATE UNIQUE INDEX "charge_refunds_webhook_event_id_key" ON "charge_refunds"("webhook_event_id");

-- CreateIndex
CREATE INDEX "charge_refunds_refunded_at_idx" ON "charge_refunds"("refunded_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_contract_id_key" ON "subscriptions"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_asaas_subscription_id_key" ON "subscriptions"("asaas_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_external_reference_key" ON "subscriptions"("external_reference");

-- CreateIndex
CREATE INDEX "webhook_events_resource_id_idx" ON "webhook_events"("resource_id");

-- CreateIndex
CREATE INDEX "webhook_events_processed_at_idx" ON "webhook_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_external_event_id_key" ON "webhook_events"("source", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_provider_envelope_id_key" ON "contracts"("provider_envelope_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_provider_document_id_key" ON "contracts"("provider_document_id");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE INDEX "expenses_status_due_date_idx" ON "expenses"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_recurrence_id_reference_month_key" ON "expenses"("recurrence_id", "reference_month");

-- CreateIndex
CREATE INDEX "reminder_logs_charge_id_idx" ON "reminder_logs"("charge_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_refunds" ADD CONSTRAINT "charge_refunds_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signers" ADD CONSTRAINT "contract_signers_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_recurrences" ADD CONSTRAINT "expense_recurrences_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "expense_recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
