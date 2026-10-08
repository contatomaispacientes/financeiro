import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// O React Router cria `new Request(url, { signal })` com o AbortSignal do jsdom, que o Request
// nativo do Node rejeita. Nos testes nada é cancelado, então o signal pode ser descartado.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.signal) {
      const { signal: _signal, ...rest } = init;
      super(input, rest);
    } else {
      super(input, init);
    }
  }
} as typeof Request;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
