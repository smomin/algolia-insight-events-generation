/**
 * Provider-agnostic LLM abstraction.
 *
 * Supports: Anthropic, OpenAI, Ollama (via OpenAI-compatible API).
 * Provider and model are resolved per-call using the same priority chain
 * as credentials: site override → app default → legacy Anthropic key.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { resolveLLMProvider } from './appConfig';
import { createLogger } from './logger';

const log = createLogger('LLM');

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
  /** Override the provider ID for this specific call (bypasses site + default resolution). */
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
 * @param siteId Optional site id for per-site provider resolution.
 */
export async function callLLM(
  messages: LLMMessage[],
  options: LLMCallOptions = {},
  siteId?: string
): Promise<string> {
  const resolved = await resolveLLMProvider(siteId, options.providerIdOverride);

  if (!resolved) {
    throw new Error(
      'No LLM provider configured. Add a provider in App Settings or set ANTHROPIC_API_KEY in your .env file.'
    );
  }

  const { provider, model } = resolved;
  const effectiveModel = options.modelOverride || model;

  const providerTag = provider.baseUrl
    ? `${provider.type}/${effectiveModel} @ ${provider.baseUrl}`
    : `${provider.type}/${effectiveModel}`;

  log.debug('call start', {
    provider: providerTag,
    siteId,
    maxTokens: options.maxTokens ?? 1024,
    hasSystemPrompt: !!options.systemPrompt,
    messageCount: messages.length,
  });

  const callStart = Date.now();

  switch (provider.type) {
    case 'anthropic': {
      const result = await callAnthropic(provider.apiKey!, effectiveModel, messages, options);
      log.debug('call complete', { provider: providerTag, durationMs: Date.now() - callStart, responseLength: result.length });
      return result;
    }

    case 'openai': {
      const result = await callOpenAICompatible({
        apiKey: provider.apiKey!,
        baseUrl: provider.baseUrl,
        model: effectiveModel,
        messages,
        options,
      });
      log.debug('call complete', { provider: providerTag, durationMs: Date.now() - callStart, responseLength: result.length });
      return result;
    }

    case 'ollama': {
      const result = await callOpenAICompatible({
        apiKey: provider.apiKey || 'ollama',
        baseUrl: provider.baseUrl || 'http://localhost:11434/v1',
        model: effectiveModel,
        messages,
        options,
      });
      log.debug('call complete', { provider: providerTag, durationMs: Date.now() - callStart, responseLength: result.length });
      return result;
    }

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

  try {
    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 1024,
      ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    log.debug('anthropic response', {
      model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      stopReason: response.stop_reason,
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Anthropic returned a non-text response');
    return block.text.trim();
  } catch (err) {
    log.error('anthropic call failed', { model, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
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

  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: options.maxTokens ?? 1024,
      messages: openaiMessages,
    });

    log.debug('openai-compatible response', {
      model,
      baseUrl: baseUrl ?? 'default',
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      finishReason: response.choices[0]?.finish_reason,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM returned an empty response');
    return content.trim();
  } catch (err) {
    log.error('openai-compatible call failed', { model, baseUrl: baseUrl ?? 'default', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
