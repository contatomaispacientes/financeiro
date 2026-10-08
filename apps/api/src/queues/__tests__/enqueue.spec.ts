import type { Queue } from 'bullmq';
import { enqueueUnique, requeue } from '../enqueue';

function fakeQueue(state?: string) {
  const job = state ? { getState: vi.fn().mockResolvedValue(state), remove: vi.fn() } : undefined;
  const queue = { add: vi.fn(), getJob: vi.fn().mockResolvedValue(job) };
  return { queue: queue as unknown as Queue, add: queue.add, job };
}

describe('ADR-010: enqueueUnique / requeue', () => {
  it('enfileira com o jobId determinístico', async () => {
    const { queue, add } = fakeQueue();
    await enqueueUnique(queue, 'apply', { id: 1 }, 'evt_abc', { attempts: 5 });
    expect(add).toHaveBeenCalledWith('apply', { id: 1 }, { attempts: 5, jobId: 'evt_abc' });
  });

  it.each(['evt:abc', '123'])('recusa jobId fora do padrão (%s)', async (jobId) => {
    const { queue, add } = fakeQueue();
    await expect(enqueueUnique(queue, 'apply', {}, jobId)).rejects.toThrow('ADR-010');
    await expect(requeue(queue, 'apply', {}, jobId)).rejects.toThrow('ADR-010');
    expect(add).not.toHaveBeenCalled();
  });

  it.each(['failed', 'completed'])('requeue remove o job %s e enfileira de novo', async (state) => {
    const { queue, add, job } = fakeQueue(state);
    await expect(requeue(queue, 'apply', {}, 'evt_abc')).resolves.toBe(true);
    expect(job!.remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith('apply', {}, { jobId: 'evt_abc' });
  });

  it.each(['waiting', 'active', 'delayed'])('requeue não duplica job %s', async (state) => {
    const { queue, add, job } = fakeQueue(state);
    await expect(requeue(queue, 'apply', {}, 'evt_abc')).resolves.toBe(false);
    expect(job!.remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('requeue enfileira quando não há job', async () => {
    const { queue, add } = fakeQueue();
    await expect(requeue(queue, 'apply', {}, 'evt_abc')).resolves.toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
  });
});
