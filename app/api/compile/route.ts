import { z } from "zod";
import { compileWithProviders } from "@/lib/providers";
import { compileRequestSchema } from "@/lib/contracts";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = compileRequestSchema.parse(await request.json());
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        try {
          emit({ type: "progress", stage: "validating", message: "Validating contract text" });
          emit({ type: "progress", stage: "compiling", message: "Compiling deterministic checks" });
          const contract = await compileWithProviders(body.specMarkdown, { signal: request.signal });
          emit({ type: "progress", stage: "compiled", message: `${contract.checks.length} safe checks compiled · ${contract.unexpressibleRules.length} AI judgment rules`, checks: contract.checks.length, judgmentRules: contract.unexpressibleRules.length });
          emit({ type: "final", contract });
        } catch (error) { emit({ type: "error", message: error instanceof Error ? error.message : "Unable to compile contract." }); }
        finally { controller.close(); }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (error) { return Response.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Invalid compilation request." : error instanceof Error ? error.message : "Unable to compile contract." }, { status: 400 }); }
}
