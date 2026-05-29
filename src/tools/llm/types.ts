import type { z } from 'zod';

/** A chat message in LangChain's role/content shape. */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StructuredCallOpts<T> {
  /** Pinned model id from env (OPENAI_MODEL_*). */
  model: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  temperature?: number;
  schema: z.ZodType<T>;
  messages: LlmMessage[];
  /** Graph node name — recorded on the llm_calls row + used for cost attribution. */
  node: string;
  /** Prompt module version ([R30]) — recorded on llm_calls.prompt_version. */
  promptVersion?: string;
  /** Langfuse trace id to associate this call with the parent report trace. */
  langfuseTraceId?: string;
}
