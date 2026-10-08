import type { JobsOptions } from 'bullmq';

/** Fila dos webhooks do Asaas: um job por `webhook_events` (spec 04). */
export const ASAAS_EVENTS_QUEUE = 'asaas-events';
export const ASAAS_EVENTS_SWEEPER_QUEUE = 'asaas-events-sweeper';

export const ASAAS_EVENT_JOB = 'apply';

export interface AsaasEventJobData {
  webhookEventId: string;
}

export const webhookEventJobId = (webhookEventId: string) => `evt_${webhookEventId}`;

export const ASAAS_EVENT_MAX_ATTEMPTS = 5;

/** WHK-02.5: 5 tentativas, espera de 10 s, 20 s, 40 s, 80 s. */
export const ASAAS_EVENT_JOB_OPTIONS: JobsOptions = {
  attempts: ASAAS_EVENT_MAX_ATTEMPTS,
  backoff: { type: 'exponential', delay: 10_000 },
};
