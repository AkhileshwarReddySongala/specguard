import { z } from "zod";
import { analyze, applyCoverageVerdict, deriveVerdict } from "@/lib/analyzer";
import { analyzeRequestSchema } from "@/lib/contracts";
import { fetchSnapshot } from "@/lib/github";
import { judgeWithProviders } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = analyzeRequestSchema.parse(await request.json());
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        try {
          emit({ type: "progress", stage: "snapshot", message: "Loading public PR evidence" });
          const snapshot = await fetchSnapshot(body.prUrl);
          const deterministic = analyze(snapshot, body.compiledContract);
          emit({ type: "progress", stage: "deterministic", message: `${deterministic.findings.length} deterministic finding(s) complete` });
          const judgment = await judgeWithProviders(snapshot, body.compiledContract, body.judgmentMode, { signal: request.signal, onProgress: (progress) => emit({ type: "progress", stage: "ai-judgment", message: `AI judgment ${progress.completedRules}/${progress.totalRules} rules`, ...progress }) });
          const findings = [...deterministic.findings, ...judgment.findings];
          const verdict = applyCoverageVerdict(deriveVerdict(findings, body.compiledContract.checks), judgment.coverage);
          const diagnostics = [...deterministic.diagnostics.filter((diagnostic) => !diagnostic.includes("await AI judgment")), ...judgment.diagnostics.map((diagnostic) => `AI judgment recovery: ${diagnostic.replace(/_/g, " ")}`)];
          if (!judgment.coverage.complete) diagnostics.push(`${judgment.coverage.unassessedRules} selected AI rule(s) were not assessed before the session ended.`);
          emit({ type: "final", result: { ...deterministic, findings, diagnostics, ...verdict, judgmentUnavailable: !judgment.coverage.complete, providerStatus: judgment.provider, judgmentCoverage: judgment.coverage } });
        } catch (error) { emit({ type: "error", message: error instanceof Error ? error.message : "Analysis failed." }); }
        finally { controller.close(); }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (error) { return Response.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Invalid analysis request." : error instanceof Error ? error.message : "Analysis failed." }, { status: 400 }); }
}