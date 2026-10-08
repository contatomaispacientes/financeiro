import { z } from '../zod.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD');

export const AuditLogQuerySchema = z
  .object({
    entity: z.string().trim().min(1).max(60).optional(),
    userId: z.uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    error: 'A data inicial deve ser anterior à final',
    path: ['from'],
  });
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export interface AuditLogDto {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  data: unknown;
  createdAt: string;
}
