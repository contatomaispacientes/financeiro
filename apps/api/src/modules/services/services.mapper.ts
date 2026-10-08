import type { ServiceDto } from '@financeiro/shared';
import type { Service } from '../../generated/prisma/client.js';

export function toServiceDto(row: Service): ServiceDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    defaultPriceCents: row.defaultPriceCents,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
