import { z } from '../zod.js';

export const WEBHOOK_EVENT_STATES = ['processed', 'pending', 'error', 'ignored'] as const;
export type WebhookEventState = (typeof WEBHOOK_EVENT_STATES)[number];

export const WebhookEventQuerySchema = z.object({
  source: z.enum(['ASAAS', 'CONTRACT', 'RECONCILE']).optional(),
  event: z.string().trim().max(60).optional(),
  state: z.enum(WEBHOOK_EVENT_STATES).optional(),
  resourceId: z.string().trim().max(80).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type WebhookEventQuery = z.infer<typeof WebhookEventQuerySchema>;

export interface WebhookEventDto {
  id: string;
  source: 'ASAAS' | 'CONTRACT' | 'RECONCILE';
  externalEventId: string;
  event: string;
  resourceId: string | null;
  /** Cobrança local ligada ao recurso (link no log), quando existir. */
  chargeId: string | null;
  state: WebhookEventState;
  result: string | null;
  attempts: number;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface WebhookEventDetailDto extends WebhookEventDto {
  payload: unknown;
}

/** WHK-03.3 */
export interface WebhookHealthDto {
  oldestPendingMinutes: number | null;
  lastReceivedAt: string | null;
  errorsLast24h: number;
  openCharges: number;
  /** Evento pendente há mais de 1 h, ou nada recebido em 7 dias com cobranças abertas. */
  alert: string | null;
}
