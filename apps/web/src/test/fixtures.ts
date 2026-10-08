import type { Paginated, SettingsDto, UserDto } from '@financeiro/shared';

export function userDto(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u-1',
    name: 'Ana Souza',
    email: 'ana@empresa.com.br',
    role: 'ADMIN',
    active: true,
    lastLoginAt: '2026-10-07T13:30:00.000Z',
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

export function page<T>(data: T[], meta: Partial<Paginated<T>['meta']> = {}): Paginated<T> {
  return { data, meta: { page: 1, pageSize: 20, total: data.length, ...meta } };
}

export function settingsDto(overrides: Partial<SettingsDto> = {}): SettingsDto {
  return {
    companyName: 'Minha Empresa',
    companyDocument: null,
    companyCity: 'São Paulo',
    defaultDueDays: 3,
    defaultFinePct: 2,
    defaultInterestPct: 1,
    contractChargeDueDays: 3,
    reminderDaysBefore: 3,
    reminderOnDueDate: true,
    reminderDaysAfter: [1, 7],
    reminderChannels: ['ASAAS'],
    companySignerName: null,
    companySignerEmail: null,
    companySignerPhone: null,
    updatedAt: '2026-10-07T12:00:00.000Z',
    ...overrides,
  };
}
