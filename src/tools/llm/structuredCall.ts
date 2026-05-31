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
  // gpt-5.x reasoning models reject the function-tool + reasoning_effort combo on
  // Chat Completions ("use /v1/responses instead") AND reject temperature ≠ 1 while
  // reasoning. The working shape on our pinned langchain (no Responses API) is the
  // json_schema response-format method + temperature 1. Confirmed live against
  // gpt-5.4 with the real schema — see scripts/probe-gpt54*.ts. [§9.1]
  const openaiReasoning = provider === 'openai' && Boolean(opts.reasoningEffort);

  const chat =
    provider === 'openai'
      ? new ChatOpenAI({
          model,
          temperature: openaiReasoning ? 1 : (opts.temperature ?? 0),
          // High-effort reasoning calls are long-running; give them a generous
          // client timeout and retry transient connection errors with backoff
          // (the SDK retries APIConnectionError up to maxRetries).
          maxRetries: 2,
          timeout: openaiReasoning ? 240_000 : 90_000,
          // Stream reasoning calls so response bytes start flowing before the
          // ~60s edge time-to-first-byte limit that resets long non-streamed
          // requests. (gpt-5.x reasons silently, so the effort must be low
          // enough that the first token lands < 60s — see Node 06 / probes.)
          ...(openaiReasoning ? { streaming: true } : {}),
          ...(opts.reasoningEffort
            ? { modelKwargs: { reasoning_effort: opts.reasoningEffort } }
            : {}),
        })
      : new ChatAnthropic({ model, temperature: opts.temperature ?? 0 });

  const structured = chat.withStructuredOutput(opts.schema, {
    includeRaw: true,
    // Reasoning models need json_schema (response_format), not function tools.
    ...(openaiReasoning ? { method: 'jsonSchema' as const } : {}),
  });
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
