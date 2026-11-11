import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

/** One cheap model that handles vision, structured output and tool calls. Override with STOCKPOT_MODEL. */
export const model = openrouter(process.env.STOCKPOT_MODEL ?? "anthropic/claude-haiku-5.5");

export const today = () => new Date().toISOString().slice(0, 10);
