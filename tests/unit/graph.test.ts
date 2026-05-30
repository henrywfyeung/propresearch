// tests/unit/graph.test.ts
import { runGraph } from '@/agents/graph';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REA_HOST,
  listing,
  mockMapbox,
  mockReaBlocked,
  mockReaOk,
  sampleRawAddress,
  sampleSubject,
} from '../fixtures/comps';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = REA_HOST;
  process.env.MAPBOX_TOKEN = 'test-token';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-30T00:00:00Z'));
});

const input = { reportId: 'r1', rawAddress: sampleRawAddress, subject: sampleSubject };

describe('reportGraph', () => {
  it('resolves the address then lands ranked comparables', async () => {
    mockMapbox(server);
    mockReaOk(server, [
      listing('FAR', { beds: 5, lat: -33.86, lng: 151.2 }),
      listing('NEAR', { beds: 3, lat: -33.8201, lng: 151.2401 }),
    ]);
    const state = await runGraph(input);
    expect(state.resolvedAddress?.suburb).toBe('Mosman');
    expect(state.comparables.map((c) => c.id)).toEqual(['NEAR', 'FAR']);
    expect(state.errors).toEqual([]);
  });

  it('completes with an empty pool + PARTIAL_DATA when REA is blocked', async () => {
    mockMapbox(server);
    mockReaBlocked(server);
    const state = await runGraph(input);
    expect(state.resolvedAddress?.suburb).toBe('Mosman');
    expect(state.comparables).toEqual([]);
    expect(state.errors[0]?.code).toBe('PARTIAL_DATA');
  });
});
