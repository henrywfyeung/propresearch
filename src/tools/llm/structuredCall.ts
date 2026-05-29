// LLM client — CLAUDE.md §9. Wraps LangChain's ChatOpenAI / ChatAnthropic
// `.withStructuredOutput()` for Zod-validated output. Chosen over the raw
// OpenAI SDK because the graph is LangGraph-based and `langfuse-langchain`
// integrates at the LangChain callback layer (§14.1).
//
// Every successful call: writes an llm_calls row SYNCHRONOUSLY (the ledger of
// truth for cost reconstruction, [R24]) before adding to reportCtx.costUsd.
// callWithFallback: one OpenAI try (pRetry inside the model), then Claude;
// if both fail → LlmProvidersUnavailableError (retryable, [R34]).

import { getReportCtx } from '@/agents/reportContext';
import { workerDb } from '@/db/client-worker';
import { llmCalls } from '@/db/schema';
import { LlmProvidersUnavailableError } from '@/lib/errors';
import { logger } from '@/lib/observability/logger';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { sql } from 'drizzle-orm';
import { estimateCostUsd } from './costs';
import type { LlmMessage, StructuredCallOpts } from './types';

type Provider = 'openai' | 'anthropic';

interface ModelResult<T> {
  parsed: T;
  usage: { promptTokens: number; completionTokens: number };
}

// Seam for unit tests: override the raw model invocation without real network.
// Non-generic (ModelResult<unknown>) so test mocks are trivially typeable;
// structuredCall casts the parsed value back to T at the call site.
type ModelRunner = (
  provider: Provider,
  model: string,
  opts: StructuredCallOpts<unknown>,
) => Promise<ModelResult<unknown>>;

let modelRunner: ModelRunner = defaultModelRunner;

/** Test-only: swap the model runner. Pass undefined to restore the default. */
export function __setModelRunner(runner?: ModelRunner): void {
  modelRunner = runner ?? defaultModelRunner;
}

function toLangchainMessages(messages: LlmMessage[]): [string, string][] {
  // LangChain accepts [role, content] tuples; map assistant→ai.
  return messages.map((m) => [m.role === 'assistant' ? 'ai' : m.role, m.content]);
}

async function defaultModelRunner(
  provider: Provider,
  model: string,
  opts: StructuredCallOpts<unknown>,
): Promise<ModelResult<unknown>> {
  const chat =
    provider === 'openai'
      ? new ChatOpenAI({
          model,
          temperature: opts.temperature ?? 0,
          // reasoning_effort is passed through modelKwargs; the exact wiring
          // must be confirmed once the real GPT-5 model id is pinned (§9.1).
          ...(opts.reasoningEffort
            ? { modelKwargs: { reasoning_effort: opts.reasoningEffort } }
            : {}),
        })
      : new ChatAnthropic({ model, temperature: opts.temperature ?? 0 });

  const structured = chat.withStructuredOutput(opts.schema, { includeRaw: true });
  const result = (await structured.invoke(toLangchainMessages(opts.messages))) as {
    raw: { usage_metadata?: { input_tokens?: number; output_tokens?: number } };
    parsed: unknown;
  };

  const meta = result.raw?.usage_metadata ?? {};
  return {
    parsed: result.parsed,
    usage: {
      promptTokens: meta.input_tokens ?? 0,
      completionTokens: meta.output_tokens ?? 0,
    },
  };
}

async function recordCall(
  provider: Provider,
  model: string,
  opts: StructuredCallOpts<unknown>,
  usage: { promptTokens: number; completionTokens: number },
  latencyMs: number,
): Promise<void> {
  const costUsd = estimateCostUsd(model, usage);
  const ctx = getReportCtx();

  // Synchronous ledger write BEFORE updating the in-memory counter — this row
  // is what rehydrateCostUsd reads after an Inngest step retry ([R24]).
  await workerDb.insert(llmCalls).values({
    reportId: ctx?.reportId ?? null,
    node: opts.node,
    provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: costUsd.toFixed(6),
    latencyMs,
    succeeded: 'true',
    langfuseTraceId: opts.langfuseTraceId ?? null,
    promptVersion: opts.promptVersion ?? null,
  });

  if (ctx) ctx.costUsd += costUsd;
}

/** Single-provider structured call (OpenAI by default). pRetry lives in the model. */
export async function structuredCall<T>(opts: StructuredCallOpts<T>): Promise<T> {
  const started = Date.now();
  const { parsed, usage } = await modelRunner('openai', opts.model, opts);
  await recordCall('openai', opts.model, opts, usage, Date.now() - started);
  return parsed as T;
}

/** OpenAI with a single Claude fallback (§9.2 / [R15]); both-down → typed error ([R34]). */
export async function callWithFallback<T>(opts: StructuredCallOpts<T>): Promise<T> {
  try {
    return await structuredCall(opts);
  } catch (openaiErr) {
    logger.warn(
      { err: String(openaiErr), node: opts.node },
      'OpenAI failed, falling back to Claude',
    );
    const fallbackModel = process.env.ANTHROPIC_MODEL_FALLBACK;
    if (!fallbackModel) {
      throw new LlmProvidersUnavailableError('ANTHROPIC_MODEL_FALLBACK not configured', {
        cause: String(openaiErr),
      });
    }
    try {
      const started = Date.now();
      const { parsed, usage } = await modelRunner('anthropic', fallbackModel, opts);
      await recordCall('anthropic', fallbackModel, opts, usage, Date.now() - started);
      return parsed as T;
    } catch (anthropicErr) {
      logger.error(
        { openaiErr: String(openaiErr), anthropicErr: String(anthropicErr), node: opts.node },
        'both LLM providers failed',
      );
      throw new LlmProvidersUnavailableError('OpenAI and Anthropic both failed', {
        openai: String(openaiErr),
        anthropic: String(anthropicErr),
      });
    }
  }
}

/**
 * Rehydrate reportCtx.costUsd from the llm_calls ledger ([R24]). Called at
 * every Inngest step entry so the cost ceiling survives step retries.
 */
export async function rehydrateCostUsd(reportId: string): Promise<number> {
  const rows = await workerDb
    .select({ total: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(sql`${llmCalls.reportId} = ${reportId}`);
  const total = Number(rows[0]?.total ?? 0);
  const ctx = getReportCtx();
  if (ctx) ctx.costUsd = total;
  return total;
}
