/**
 * Provider-agnostic LLM abstraction.
 *
 * Supports: Anthropic, OpenAI, Ollama (via OpenAI-compatible API).
 * Provider and model are resolved per-call using the same priority chain
 * as credentials: industry override → app default → legacy Anthropic key.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { resolveLLMProvider } from './appConfig';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  systemPrompt?: string;
  maxTokens?: number;
  /** Override the model for this specific call (over provider default). */
  modelOverride?: string;
  /** Override the provider ID for this specific call (bypasses industry + default resolution). */
  providerIdOverride?: string;
}

// ─────────────────────────────────────────────
// Core call
// ─────────────────────────────────────────────

/**
 * Calls the resolved LLM provider with the given messages and returns the
 * text response as a string.
 *
 * @param messages   Conversation messages (user/assistant turns).
 * @param options    System prompt, max tokens, optional model override.
 * @param industryId Optional industry id for per-industry provider resolution.
 */
export async function callLLM(
  messages: LLMMessage[],
  options: LLMCallOptions = {},
  industryId?: string
): Promise<string> {
  const resolved = await resolveLLMProvider(industryId, options.providerIdOverride);

  if (!resolved) {
    throw new Error(
      'No LLM provider configured. Add a provider in App Settings or set ANTHROPIC_API_KEY in your .env file.'
    );
  }

  const { provider, model } = resolved;
  const effectiveModel = options.modelOverride || model;

  switch (provider.type) {
    case 'anthropic':
      return callAnthropic(provider.apiKey!, effectiveModel, messages, options);

    case 'openai':
      return callOpenAICompatible({
        apiKey: provider.apiKey!,
        baseUrl: provider.baseUrl,
        model: effectiveModel,
        messages,
        options,
      });

    case 'ollama':
      return callOpenAICompatible({
        apiKey: provider.apiKey || 'ollama', // ollama doesn't require a real key
        baseUrl: provider.baseUrl || 'http://localhost:11434/v1',
        model: effectiveModel,
        messages,
        options,
      });

    default:
      throw new Error(`Unknown provider type: ${(provider as { type: string }).type}`);
  }
}

// ─────────────────────────────────────────────
// Provider implementations
// ─────────────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: LLMMessage[],
  options: LLMCallOptions
): Promise<string> {
  const client = new Anthropic({ apiKey, maxRetries: 4, timeout: 60_000 });

  const response = await client.messages.create({
    model,
    max_tokens: options.maxTokens ?? 1024,
    ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Anthropic returned a non-text response');
  return block.text.trim();
}

async function callOpenAICompatible({
  apiKey,
  baseUrl,
  model,
  messages,
  options,
}: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: LLMMessage[];
  options: LLMCallOptions;
}): Promise<string> {
  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
    maxRetries: 4,
    timeout: 60_000,
  };
  if (baseUrl) clientOptions.baseURL = baseUrl;

  const client = new OpenAI(clientOptions);

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];
  if (options.systemPrompt) {
    openaiMessages.push({ role: 'system', content: options.systemPrompt });
  }
  for (const m of messages) {
    openaiMessages.push({ role: m.role, content: m.content });
  }

  const response = await client.chat.completions.create({
    model,
    max_tokens: options.maxTokens ?? 1024,
    messages: openaiMessages,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('LLM returned an empty response');
  return content.trim();
}
