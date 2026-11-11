import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({ apiKey: (process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_API_KEY) });

/** One cheap model that handles vision, structured output and tool calls. Override with STOCKPOT_MODEL. */
export const model = openrouter(process.env.STOCKPOT_MODEL ?? "anthropic/claude-haiku-5.5");

export const today = () => new Date().toISOString().slice(0, 10);

/** Wrap an AI route so failures come back as `{ error }` JSON the UI can show, not an empty 500. */
export function aiRoute(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (!(process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_API_KEY)) {
      return Response.json(
        { error: "AI isn't connected yet: no OpenRouter API key is set. Add OpenRouter with Stripe Projects." },
        { status: 503 },
      );
    }
    try {
      return await handler(req);
    } catch (e) {
      console.error(e);
      return Response.json({ error: e instanceof Error ? e.message : "Something went wrong" }, { status: 500 });
    }
  };
}
