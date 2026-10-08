import { Role } from './enums.js';

/** Matriz de permissões do design da spec 00. Fonte única para API (@Roles) e web (menus e botões). */
export const Permission = {
  VIEW_REPORTS: [Role.ADMIN, Role.FINANCEIRO, Role.LEITURA],
  MANAGE_RECORDS: [Role.ADMIN, Role.FINANCEIRO], // clientes, serviços, despesas
  MANAGE_CHARGES: [Role.ADMIN, Role.FINANCEIRO], // criar, cancelar, reenviar
  REFUND_CHARGE: [Role.ADMIN],
  CANCEL_SUBSCRIPTION: [Role.ADMIN, Role.FINANCEIRO],
  MANAGE_CONTRACTS: [Role.ADMIN, Role.FINANCEIRO],
  MANAGE_CONTRACT_TEMPLATES: [Role.ADMIN],
  ADMINISTER: [Role.ADMIN], // configurações, usuários, auditoria, reprocessar webhook, reconciliar
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof Permission;

export function can(role: Role | undefined, permission: Permission): boolean {
  return role !== undefined && (Permission[permission] as readonly Role[]).includes(role);
}
