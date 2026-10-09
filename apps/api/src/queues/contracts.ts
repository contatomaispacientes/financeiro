import type { JobsOptions } from 'bullmq';

/** Filas da spec 07 (overview.md, "Filas"). */
export const CONTRACT_EVENTS_QUEUE = 'contract-events';
export const CONTRACT_CHARGE_QUEUE = 'contract-charge';
export const CONTRACT_FILE_QUEUE = 'contract-file';
export const CONTRACT_EXPIRATION_QUEUE = 'contract-expiration';

export const CONTRACT_EVENT_JOB = 'apply';
export const CONTRACT_CHARGE_JOB = 'generate';
export const CONTRACT_FILE_JOB = 'download';

/** ADR-010: ids sem `:`. */
export const contractChargeJobId = (contractId: string) => `ctrcharge_${contractId}`;
export const contractFileJobId = (contractId: string) => `ctrfile_${contractId}`;

export const CONTRACT_EVENT_JOB_OPTIONS: JobsOptions = { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } };
/** CTR-05.4: 5 tentativas, backoff exponencial de 30 s. */
export const CONTRACT_CHARGE_JOB_OPTIONS: JobsOptions = { attempts: 5, backoff: { type: 'exponential', delay: 30_000 } };
export const CONTRACT_FILE_JOB_OPTIONS: JobsOptions = { attempts: 5, backoff: { type: 'exponential', delay: 30_000 } };
