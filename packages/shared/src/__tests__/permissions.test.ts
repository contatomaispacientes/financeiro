import { describe, it, expect } from 'vitest';
import { can, type Permission } from '../permissions.js';
import type { Role } from '../enums.js';

// Espelho da tabela "Matriz de permissões" de docs/specs/00-fundacao/design.md
const matrix: Array<[string, Permission, Record<Role, boolean>]> = [
  ['Ver dashboard, listas, relatórios', 'VIEW_REPORTS', { ADMIN: true, FINANCEIRO: true, LEITURA: true }],
  ['CRUD clientes, serviços, despesas', 'MANAGE_RECORDS', { ADMIN: true, FINANCEIRO: true, LEITURA: false }],
  ['Criar, cancelar, reenviar cobrança', 'MANAGE_CHARGES', { ADMIN: true, FINANCEIRO: true, LEITURA: false }],
  ['Estornar cobrança', 'REFUND_CHARGE', { ADMIN: true, FINANCEIRO: false, LEITURA: false }],
  ['Cancelar assinatura (recorrência)', 'CANCEL_SUBSCRIPTION', { ADMIN: true, FINANCEIRO: true, LEITURA: false }],
  ['Contratos: criar, enviar, cancelar', 'MANAGE_CONTRACTS', { ADMIN: true, FINANCEIRO: true, LEITURA: false }],
  ['Modelos de contrato', 'MANAGE_CONTRACT_TEMPLATES', { ADMIN: true, FINANCEIRO: false, LEITURA: false }],
  ['Configurações, usuários, auditoria, reprocessar webhook, reconciliar', 'ADMINISTER', { ADMIN: true, FINANCEIRO: false, LEITURA: false }],
];

describe('[FND-03.2] matriz de permissões', () => {
  it.each(matrix)('%s', (_label, permission, expected) => {
    for (const role of Object.keys(expected) as Role[]) {
      expect(can(role, permission), `${role} × ${permission}`).toBe(expected[role]);
    }
  });

  it('nega tudo sem papel', () => {
    expect(can(undefined, 'VIEW_REPORTS')).toBe(false);
  });
});
