import type { JobsOptions, Queue } from 'bullmq';

/** ADR-010: `jobId` com `_` como separador e prefixo não numérico; `:` é proibido. */
function assertJobId(jobId: string) {
  if (jobId.includes(':') || /^\d+$/.test(jobId)) {
    throw new Error(`jobId inválido (ADR-010): ${jobId}`);
  }
}

/** Deduplica pelo `jobId`: se já existe um job com esse id (mesmo concluído ou falho), o BullMQ não faz nada. */
export async function enqueueUnique<T>(queue: Queue, name: string, data: T, jobId: string, opts: JobsOptions = {}) {
  assertJobId(jobId);
  await queue.add(name, data, { ...opts, jobId });
}

/**
 * Reenfileira mesmo depois de concluído ou esgotado: remove o job `failed`/`completed` antes de adicionar.
 * Retorna `false` sem enfileirar se o job ainda está esperando, ativo ou agendado.
 */
export async function requeue<T>(queue: Queue, name: string, data: T, jobId: string, opts: JobsOptions = {}): Promise<boolean> {
  assertJobId(jobId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed' || state === 'completed') await existing.remove();
    else if (state !== 'unknown') return false;
  }
  await queue.add(name, data, { ...opts, jobId });
  return true;
}
