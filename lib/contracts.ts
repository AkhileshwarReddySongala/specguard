import { z } from "zod";

export const severitySchema = z.enum(["MUST", "SHOULD"]);
export const enforcementModeSchema = z.enum(["restricted-import", "restricted-syntax", "path-glob", "dependency", "required-test", "judgment"]);

export const compiledCheckSchema = z.object({
  id: z.string(), requirementQuote: z.string(), specLine: z.number().int().positive(),
  level: severitySchema, mode: enforcementModeSchema, target: z.string(), rationale: z.string(),
});
export const compiledContractSchema = z.object({ checks: z.array(compiledCheckSchema).max(30), unexpressibleRules: z.array(z.string()), compiler: z.literal("deterministic-fallback") });
export const compileRequestSchema = z.object({ specMarkdown: z.string().min(1).max(30_000) });

export const changedFileSchema = z.object({ path: z.string(), content: z.string(), status: z.enum(["added", "modified", "removed"]) });
export const prSnapshotSchema = z.object({ owner: z.string(), repo: z.string(), number: z.number().int().positive(), title: z.string(), unifiedDiff: z.string(), changedFiles: z.array(changedFileSchema).max(25) });
export const findingSchema = z.object({ id: z.string(), requirementQuote: z.string(), specLine: z.number().int().positive(), filePath: z.string(), line: z.number().int().positive(), diffHunk: z.string(), violationType: z.string(), action: z.string(), source: z.enum(["deterministic", "llm"]), confidence: z.enum(["high", "low"]), preExisting: z.boolean() });
export const verdictSchema = z.enum(["approved", "approved_with_warnings", "changes_required", "merge_blocked"]);
export const analysisResultSchema = z.object({ snapshot: prSnapshotSchema, contract: compiledContractSchema, findings: z.array(findingSchema), verdict: verdictSchema, complianceScore: z.number().int().min(0).max(100), diagnostics: z.array(z.string()), judgmentUnavailable: z.boolean() });
export const analyzeRequestSchema = z.object({ prUrl: z.string().min(1).max(2_048), compiledContract: compiledContractSchema });

export type CompiledCheck = z.infer<typeof compiledCheckSchema>;
export type CompiledContract = z.infer<typeof compiledContractSchema>;
export type PRSnapshot = z.infer<typeof prSnapshotSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Verdict = z.infer<typeof verdictSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
