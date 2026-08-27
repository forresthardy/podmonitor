/**
 * The provider adapter interface. Every LLM backend (Groq, OpenAI, Anthropic, ...)
 * implements this one shape, so the summarization job never branches on which provider
 * is active — swapping providers is a config change (`LLM_PROVIDER`), never a code change.
 */

export interface LLMMessage {
  role: 'system' | 'user'
  content: string
}

export interface LLMCompletionRequest {
  messages: LLMMessage[]
  /** Low temperature: summaries are meant to be grounded, not creative. */
  temperature?: number
  maxTokens?: number
}

export interface LLMProvider {
  /** Short identifier for logging and for the `summaries.model` column, e.g. `groq`. */
  readonly name: string
  /** The concrete model in use, e.g. `llama-3.3-70b-versatile`. */
  readonly model: string
  /** Runs one completion and returns the raw text content. */
  complete(request: LLMCompletionRequest): Promise<string>
}
