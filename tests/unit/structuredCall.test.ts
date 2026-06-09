// structuredCall / callWithFallback control-flow tests. Uses the
// __setModelRunner seam so no real LLM is hit, and mocks the worker DB so no
// real Postgres is needed. Verifies: cost accrues to reportCtx, the ledger
// write happens, the single-fallback contract ([R15]), and both-down →
// LlmProvidersUnavailableError ([R34]).

import { getReportCtx, runWithReportContext } from '@/agents/reportContext';
import { LlmProvidersUnavailableError } from '@/lib/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const insertValues = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db/client-worker', () => ({
  workerDb: {
    insert: () => ({ values: insertValues }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ total: '0' }]) }) }),
  },
}));

import { __setModelRunner, callWithFallback, structuredCall } from '@/tools/llm/structuredCall';
import type { StructuredCallOpts } from '@/tools/llm/types';

const schema = z.object({ answer: z.string() });
const baseOpts = {
  model: 'gpt-5-2026',
  schema,
  messages: [{ role: 'user' as const, content: 'hi' }],
  node: 'compose',
};

beforeEach(() => {
  insertValues.mockClear();
  process.env.ANTHROPIC_MODEL_FALLBACK = 'claude-sonnet-4-5-2026';
});

afterEach(() => {
  __setModelRunner(); // restore default
});

describe('structuredCall', () => {
  it('returns parsed output, writes an llm_calls row, and accrues cost to ctx', async () => {
    __setModelRunner(async (_p, _m, _o) => ({
      parsed: { answer: 'forty-two' },
      usage: { promptTokens: 10_000, completionTokens: 2_000 },
    }));

    let observedCost = 0;
    const out = await runWithReportContext({ reportId: 'r1' }, async () => {
      const r = await structuredCall(baseOpts);
      observedCost = getReportCtx()!.costUsd;
      return r;
    });

    expect(out.answer).toBe('forty-two');
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(observedCost).toBeCloseTo(0.0325, 6); // matches the cost test
  });
});

describe('callWithFallback', () => {
  it('uses OpenAI when it succeeds (no fallback)', async () => {
    const calls: string[] = [];
    __setModelRunner(async (provider) => {
      calls.push(provider);
      return { parsed: { answer: 'ok' }, usage: { promptTokens: 1, completionTokens: 1 } };
    });
    const out = await runWithReportContext({ reportId: 'r2' }, () => callWithFallback(baseOpts));
    expect(out.answer).toBe('ok');
    expect(calls).toEqual(['openai']);
  });

  it('falls back to Anthropic exactly once on OpenAI failure', async () => {
    const calls: string[] = [];
    __setModelRunner(async (provider) => {
      calls.push(provider);
      if (provider === 'openai') throw new Error('openai 503');
      return { parsed: { answer: 'from-claude' }, usage: { promptTokens: 1, completionTokens: 1 } };
    });
    const out = await runWithReportContext({ reportId: 'r3' }, () => callWithFallback(baseOpts));
    expect(out.answer).toBe('from-claude');
    expect(calls).toEqual(['openai', 'anthropic']);
  });

  it('throws LlmProvidersUnavailableError when both fail [R34]', async () => {
    __setModelRunner(async (provider) => {
      throw new Error(`${provider} down`);
    });
    await expect(
      runWithReportContext({ reportId: 'r4' }, () => callWithFallback(baseOpts)),
    ).rejects.toBeInstanceOf(LlmProvidersUnavailableError);
  });
});

describe('toLangchainMessages — multimodal content', () => {
  it('passes array content through to the model runner unchanged', async () => {
    // The __setModelRunner seam receives the opts as-is, so we can inspect
    // what messages were passed after toLangchainMessages processed them.
    // We verify the runner receives the multimodal message by checking that
    // structuredCall completes without error when content is an array.
    const capturedOpts: StructuredCallOpts<unknown>[] = [];
    __setModelRunner(async (_p, _m, opts) => {
      capturedOpts.push(opts);
      return { parsed: { answer: 'ok' }, usage: { promptTokens: 1, completionTokens: 1 } };
    });

    const multimodalOpts = {
      ...baseOpts,
      messages: [
        { role: 'system' as const, content: 'You are an inspector.' },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'Inspect these photos.' },
            { type: 'image_url' as const, image_url: { url: 'https://example.com/photo.jpg' } },
          ],
        },
      ],
    };

    const out = await runWithReportContext({ reportId: 'r5' }, () =>
      structuredCall(multimodalOpts),
    );
    expect(out.answer).toBe('ok');

    // The opts were forwarded to the runner — the multimodal message is preserved
    const forwardedMessages = capturedOpts[0]?.messages;
    expect(forwardedMessages).toHaveLength(2);
    expect(Array.isArray(forwardedMessages?.[1]?.content)).toBe(true);
  });

  it('keeps string content working unchanged (no regression)', async () => {
    __setModelRunner(async (_p, _m, _opts) => ({
      parsed: { answer: 'string-ok' },
      usage: { promptTokens: 1, completionTokens: 1 },
    }));
    const out = await runWithReportContext({ reportId: 'r6' }, () => structuredCall(baseOpts));
    expect(out.answer).toBe('string-ok');
  });
});
