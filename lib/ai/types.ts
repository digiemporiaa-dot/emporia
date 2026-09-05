/**
 * The AI provider contract.
 *
 * One abstraction, provider-swappable (CLAUDE.md 16). Nothing above this file
 * knows which vendor answers: callers describe a task and receive text or a
 * parsed object.
 *
 * Two rules shape the whole surface:
 *
 *  - **Every result is a draft.** Nothing here writes to the database. A
 *    caller renders the suggestion, a person edits it, and the person saves.
 *  - **The model is never a source of business figures.** Any number it may
 *    mention is passed in from the database in `facts`; the prompts forbid
 *    inventing one, and the callers that show figures render them from their
 *    own data rather than from the model's prose (CLAUDE.md 2 rule 5, 16).
 */

export type AITask =
  | "summarizeLead"
  | "scoreLead"
  | "generateProposal"
  | "generateContent"
  | "generateSEOContent"
  | "analyzeCRM";

export type CompletionRequest = {
  /** Which product feature is asking. Recorded, and used for logging. */
  task: AITask;
  /** The operator instruction. Stable per task, so it caches well. */
  system: string;
  /** The request itself, built from database facts. */
  prompt: string;
  /** Upper bound on the reply. A task that needs more says so explicitly. */
  maxTokens?: number;
};

export type CompletionResult = {
  text: string;
  /** What the call cost, for the audit trail. */
  usage: { inputTokens: number; outputTokens: number };
  /** The model that actually answered, which may differ from the one asked. */
  model: string;
};

/**
 * A request whose reply must be an object of a known shape.
 *
 * The schema is enforced by the provider rather than by parsing prose, so a
 * caller never has to guess whether the model wrapped its JSON in a sentence.
 */
export type StructuredRequest<T> = CompletionRequest & {
  /** JSON Schema the reply must satisfy. */
  schema: Record<string, unknown>;
  /** Narrow the parsed value, or throw. Belt and braces over the schema. */
  parse: (value: unknown) => T;
};

export interface AIProvider {
  readonly configured: boolean;
  /** For the admin screen: which vendor and model would answer. */
  readonly describe: string;

  complete(request: CompletionRequest): Promise<CompletionResult>;

  completeStructured<T>(
    request: StructuredRequest<T>,
  ): Promise<CompletionResult & { data: T }>;
}
