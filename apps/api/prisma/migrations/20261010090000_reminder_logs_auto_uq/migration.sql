-- REG-03.2: lembrete automático (e de evento) sai uma vez por cobrança, tipo, canal e dia da régua.
-- Envios MANUAL podem repetir. Índice parcial: o Prisma não expressa (data-model.md, "Objetos criados por SQL").
CREATE UNIQUE INDEX "reminder_logs_auto_uq" ON "reminder_logs" ("charge_id", "kind", "channel", "offset_days") WHERE "kind" <> 'MANUAL';
