import { analyze, deriveVerdict } from "@/lib/analyzer";
import { analyzeRequestSchema } from "@/lib/contracts";
import { fetchSnapshot } from "@/lib/github";
import { judgeWithOllama } from "@/lib/ollama";

export async function POST(request: Request) {
  try {
    const body = analyzeRequestSchema.parse(await request.json());
    const snapshot = await fetchSnapshot(body.prUrl);
    const deterministic = analyze(snapshot, body.compiledContract);
    try {
      const judgmentFindings = await judgeWithOllama(snapshot, body.compiledContract);
      const findings = [...deterministic.findings, ...judgmentFindings];
      return Response.json({ ...deterministic, findings, ...deriveVerdict(findings, body.compiledContract.checks), judgmentUnavailable: false });
    } catch (judgmentError) {
      return Response.json({ ...deterministic, judgmentUnavailable: body.compiledContract.unexpressibleRules.length > 0, diagnostics: [...deterministic.diagnostics, judgmentError instanceof Error ? judgmentError.message : "Open-source judgment was unavailable."] });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 400 });
  }
}
