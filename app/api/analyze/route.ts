import { analyze } from "@/lib/analyzer";
import { compiledContractSchema } from "@/lib/contracts";
import { fetchSnapshot } from "@/lib/github";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const contract = compiledContractSchema.parse(body.compiledContract);
    const snapshot = await fetchSnapshot(body.prUrl);
    return Response.json(analyze(snapshot, contract));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 400 });
  }
}
