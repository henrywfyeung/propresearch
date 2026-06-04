// LLM client — CLAUDE.md §9. Wraps LangChain's ChatOpenAI / ChatAnthropic
// `.withStructuredOutput()` for Zod-validated output (langfuse-langchain hooks the
// LangChain callback layer, §14.1). EXCEPTION: OpenAI *reasoning* calls go straight
// to the OpenAI SDK Responses API in background mode — Chat Completions can't carry
// a >60s silent-reasoning request (see runOpenAiReasoning / [§9.1]).
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
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { sql } from 'drizzle-orm';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { recordToSink } from './costSink';
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

function toLangchainMessages(
  messages: LlmMessage[],
): ([string, string] | HumanMessage | SystemMessage | AIMessage)[] {
  // LangChain accepts [role, content] tuples for plain text. For multimodal
  // messages (array content) the tuple form rejects arrays, so we construct
  // message objects directly from @langchain/core/messages instead.
  return messages.map((m) => {
    if (Array.isArray(m.content)) {
      // Pass the ContentPart[] directly — LangChain's MessageContentComplex[]
      // accepts { type: 'text' } and { type: 'image_url' } parts natively.
      switch (m.role) {
        case 'system':
          return new SystemMessage({ content: m.content });
        case 'assistant':
          return new AIMessage({ content: m.content });
        default:
          return new HumanMessage({ content: m.content });
      }
    }
    // String content: original tuple path (assistant → 'ai').
    return [m.role === 'assistant' ? 'ai' : m.role, m.content] as [string, string];
  });
}

// --- OpenAI reasoning via the Responses API (background mode) ----------------
// gpt-5.x reasons SILENTLY, often >60s at medium/high effort. On Chat Completions
// the connection resets at the ~60s edge time-to-first-byte limit (and function
// tools + reasoning_effort isn't supported there at all). The escape is the
// Responses API in BACKGROUND mode: create() returns immediately, then we poll —
// no held connection, so the 60s limit never applies. langchain 0.3.14 has no
// Responses API, so we call the OpenAI SDK directly here. Confirmed live: high
// effort completes ~158s with full structured output (scripts/probe-responses-bg).
let openaiClient: OpenAI | undefined;
function getOpenAi(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function extractResponsesText(resp: { output_text?: string; output?: unknown }): string {
  // output_text is a convenience getter but comes back empty on a *retrieved*
  // background response; fall back to the message item's output_text content.
  if (typeof resp.output_text === 'string' && resp.output_text.length > 0) return resp.output_text;
  // biome-ignore lint/suspicious/noExplicitAny: narrowing the Responses output-item union
  const items = (resp.output as any[]) ?? [];
  const msg = items.find((o) => o?.type === 'message');
  const part = msg?.content?.find((c: { type?: string }) => c?.type === 'output_text');
  return part?.text ?? '';
}

/** Max gpt-5.4 reasoning attempts (1 initial + retries). */
const REASONING_MAX_ATTEMPTS = 3;

/** One create-and-poll of a background reasoning job; throws on timeout / non-completion. */
async function runOpenAiReasoningOnce(
  model: string,
  opts: StructuredCallOpts<unknown>,
  timeoutMs: number,
): Promise<ModelResult<unknown>> {
  const client = getOpenAi();
  const input = opts.messages.map((m) => ({
    // 'developer' is the reasoning-model equivalent of a system message.
    // Reasoning calls are always text-only; content is always a string here.
    role: m.role === 'system' ? ('developer' as const) : m.role,
    content: m.content as string,
  }));
  let resp = await client.responses.create({
    model,
    reasoning: { effort: opts.reasoningEffort as 'low' | 'medium' | 'high' },
    input,
    text: { format: zodTextFormat(opts.schema, 'structured_output') },
    background: true,
  });
  const deadline = Date.now() + timeoutMs;
  while (resp.status === 'queued' || resp.status === 'in_progress') {
    if (Date.now() > deadline) {
      // Abandon the stalled job (best-effort cancel) before retrying fresh.
      await client.responses.cancel(resp.id).catch(() => {});
      throw new Error(`OpenAI Responses timed out (status=${resp.status}, id=${resp.id})`);
    }
    await sleep(2500);
    resp = await client.responses.retrieve(resp.id);
  }
  if (resp.status !== 'completed') {
    throw new Error(
      `OpenAI Responses status=${resp.status}${resp.error ? `: ${resp.error.message}` : ''}`,
    );
  }
  return {
    parsed: opts.schema.parse(JSON.parse(extractResponsesText(resp))),
    usage: {
      promptTokens: resp.usage?.input_tokens ?? 0,
      completionTokens: resp.usage?.output_tokens ?? 0,
    },
  };
}

/**
 * gpt-5.4 reasoning via the Responses API (background mode), with retries.
 *
 * High-effort jobs occasionally stall; rather than fail over to another provider
 * (which needs a separate key + cost), we abandon a stalled poll and issue a
 * FRESH request — a new job almost always completes quickly. This targets the
 * real failure (a stuck job, not a broken provider). A shorter per-ATTEMPT
 * deadline is intentional: it abandons a stall sooner, then retries.
 *
 * Per-attempt deadline default 280s stays < Vercel Pro's 300s function limit;
 * OPENAI_RESPONSES_TIMEOUT_MS overrides it for non-Vercel callers (the CLI).
 */
async function runOpenAiReasoning(
  model: string,
  opts: StructuredCallOpts<unknown>,
): Promise<ModelResult<unknown>> {
  const perAttemptMs =
    opts.reasoningTimeoutMs ?? (Number(process.env.OPENAI_RESPONSES_TIMEOUT_MS) || 280_000);
  const maxAttempts = opts.reasoningMaxAttempts ?? REASONING_MAX_ATTEMPTS;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runOpenAiReasoningOnce(model, opts, perAttemptMs);
    } catch (err) {
      lastErr = err;
      logger.warn(
        { attempt, maxAttempts, model, err: String(err) },
        'OpenAI reasoning attempt failed; retrying with a fresh request',
      );
    }
  }
  throw lastErr;
}

async function defaultModelRunner(
  provider: Provider,
  model: string,
  opts: StructuredCallOpts<unknown>,
): Promise<ModelResult<unknown>> {
  // OpenAI reasoning models go through the Responses API in background mode (above).
  if (provider === 'openai' && opts.reasoningEffort) {
    return runOpenAiReasoning(model, opts);
  }

  // Non-reasoning calls (compose, classification, the Claude fallback): langchain
  // structured output over Chat Completions works fine.
  const chat =
    provider === 'openai'
      ? new ChatOpenAI({ model, temperature: opts.temperature ?? 0, maxRetries: 2 })
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

  // Optional in-memory per-node cost collector (CLI cost breakdown; no-op when
  // no sink is active — i.e. the normal app/server path).
  recordToSink({
    node: opts.node,
    provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd,
    latencyMs,
  });

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

/** Single-provider structured call (OpenAI). Retries live in the runner (reasoning
 *  path retries a fresh Responses job; Chat path uses ChatOpenAI maxRetries). */
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
