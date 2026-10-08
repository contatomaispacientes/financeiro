import { maskDocument, type Address, type CustomerDto, type Role } from '@financeiro/shared';
import type { Customer } from '../../generated/prisma/client.js';
import type { AsaasCustomerInput } from '../../integrations/asaas/asaas.client';

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

/** REG-02.1/REG-05.1: notificações do Asaas só se o canal ASAAS está ligado e o cliente aceita lembretes. */
export function asaasNotificationDisabled(customer: Customer, reminderChannels: string[]): boolean {
  return !(reminderChannels.includes('ASAAS') && customer.remindersEnabled);
}

/** Payload completo do cliente para POST/PUT /customers (campos vazios vão como "" para limpar no Asaas). */
export function toAsaasCustomer(customer: Customer, notificationDisabled: boolean): AsaasCustomerInput {
  const address = normalizeAddress(customer.address);
  const phone = customer.phone ?? '';
  return {
    name: customer.name,
    cpfCnpj: customer.document,
    email: customer.email ?? '',
    mobilePhone: phone.length === 11 ? phone : '',
    phone: phone.length === 10 ? phone : '',
    postalCode: address?.postalCode ?? '',
    address: address?.street ?? '',
    addressNumber: address?.number ?? '',
    complement: address?.complement ?? '',
    province: address?.district ?? '',
    externalReference: customer.id,
    notificationDisabled,
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
