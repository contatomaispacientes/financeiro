import type { JobsOptions } from 'bullmq';

/** Fila da régua (spec 08): um job por lembrete + o cron diário. */
export const REMINDERS_QUEUE = 'reminders';
export const REMINDER_SEND_JOB = 'send';
export const REMINDER_DAILY_JOB = 'daily';

export interface ReminderJobData {
  chargeId: string;
  kind: string;
  channel: 'EMAIL' | 'WHATSAPP';
  offsetDays: number;
  referenceDate: string;
}

/** ADR-010: sem `:`; offset negativo vira `m3` para −3. */
export const reminderJobId = (d: Pick<ReminderJobData, 'chargeId' | 'kind' | 'channel' | 'offsetDays'>) =>
  `rem_${d.chargeId}_${d.kind}_${d.channel}_${d.offsetDays < 0 ? `m${-d.offsetDays}` : d.offsetDays}`;

/** REG-03.5: 3 tentativas, 5 min entre elas. */
export const REMINDER_JOB_OPTIONS: JobsOptions = { attempts: 3, backoff: { type: 'fixed', delay: 5 * 60_000 } };
