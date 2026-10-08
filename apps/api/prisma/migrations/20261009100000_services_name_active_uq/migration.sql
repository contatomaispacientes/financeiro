-- SRV-01.2: nome único entre serviços ativos, sem diferenciar maiúsculas.
-- Índice de expressão parcial: o Prisma não o expressa e o diff o ignora (data-model.md, "Objetos criados por SQL").
CREATE UNIQUE INDEX "services_name_active_uq" ON "services" (lower("name")) WHERE "active";
