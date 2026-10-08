import { maskDocument, type Address, type CustomerDto, type Role } from '@financeiro/shared';
import type { Customer } from '../../generated/prisma/client.js';

/** CLI-02.4: LEITURA vê o documento mascarado (matriz de permissões da spec 00). */
export function documentFor(document: string, role: Role): string {
  return role === 'LEITURA' ? maskDocument(document) : document;
}

/** Endereço com as chaves sempre na mesma ordem (comparação estável na auditoria). */
export function normalizeAddress(value: unknown): Address | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Address;
  return {
    postalCode: a.postalCode,
    street: a.street,
    number: a.number,
    complement: a.complement ?? null,
    district: a.district,
    city: a.city,
    state: a.state,
  };
}

/** DATE do Postgres chega como meia-noite UTC: "AAAA-MM-DD" sem passar por fuso. */
export const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

export function toCustomerDto(row: Customer, role: Role): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    personType: row.personType,
    document: documentFor(row.document, role),
    email: row.email,
    phone: row.phone,
    address: normalizeAddress(row.address),
    notes: row.notes,
    remindersEnabled: row.remindersEnabled,
    asaasCustomerId: row.asaasCustomerId,
    asaasSyncError: row.asaasSyncError,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
