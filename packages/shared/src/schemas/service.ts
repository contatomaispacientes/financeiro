import { z } from '../zod.js';

// Base sem defaults: ServiceUpdateSchema (= base.partial()) não pode reaplicar default num PATCH.
const ServiceBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: 'Informe o nome (mínimo 2 caracteres)' })
    .max(120, { error: 'Nome com no máximo 120 caracteres' }),
  description: z
    .string()
    .trim()
    .max(500, { error: 'Descrição com no máximo 500 caracteres' })
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  defaultPriceCents: z.number().int().positive({ error: 'Informe um preço maior que zero' }),
  active: z.boolean(),
});

export const ServiceCreateSchema = ServiceBaseSchema.extend({ active: z.boolean().default(true) });
export type ServiceCreateInput = z.infer<typeof ServiceCreateSchema>;

export const ServiceUpdateSchema = ServiceBaseSchema.partial().refine((v) => Object.keys(v).length > 0, {
  error: 'Informe ao menos um campo',
});
export type ServiceUpdateInput = z.infer<typeof ServiceUpdateSchema>;

export const ServiceListQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  search: z.string().trim().max(100).optional(),
});
export type ServiceListQuery = z.infer<typeof ServiceListQuerySchema>;

export interface ServiceDto {
  id: string;
  name: string;
  description: string | null;
  defaultPriceCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** SRV-03.1: `usageCount` = vendas distintas (parcelamento conta 1, assinatura conta 1). */
export interface ServiceListItemDto extends ServiceDto {
  usageCount: number;
}
