-- One template per (kind, channel, offset); NULL offset counts as a value (PostgreSQL 15+).
CREATE UNIQUE INDEX "reminder_templates_uq" ON "reminder_templates" ("kind", "channel", "offset_days") NULLS NOT DISTINCT;
