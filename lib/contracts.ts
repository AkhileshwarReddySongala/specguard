import { z } from "zod";

export const MAX_CONTRACT_CHARS = 100_000;

export const severitySchema = z.enum(["MUST", "SHOULD"]);
export const enforcementModeSchema = z.enum(["restricted-import", "restricted-syntax", "path-glob", "dependency", "required-test", "judgment"]);
export const compilerSchema = z.enum(["nvidia", "gemini", "ollama", "deterministic-fallback"]);
export const providerDiagnosticSchema = z.enum(["timeout", "gateway_timeout", "rate_limited", "invalid_output", "cooldown"]);
export const contractRuleSchema = z.object({ id: z.string().min(1), requirementQuote: z.string().min(1), specLine: z.number().int().positive(), level: severitySchema });
export const compiledCheckSchema = contractRuleSchema.extend({ mode: enforcementModeSchema, target: z.string(), rationale: z.string() });
export const compiledContractSchema = z.object({
  sourceRules: z.array(contractRuleSchema).max(500).default([]),
  checks: z.array(compiledCheckSchema).max(500),
  unexpressibleRules: z.array(contractRuleSchema).max(500),
  compiler: compilerSchema,
  compilerDiagnostics: z.array(providerDiagnosticSchema).max(20).default([]),
});
export const compileRequestSchema = z.object({ specMarkdown: z.string().min(1).max(MAX_CONTRACT_CHARS, "Contract must be 100,000 characters or fewer.") });
export const changedFileSchema = z.object({ path: z.string(), content: z.string(), status: z.enum(["added", "modified", "removed"]) });
export const prSnapshotSchema = z.object({ owner: z.string(), repo: z.string(), number: z.number().int().positive(), title: z.string(), unifiedDiff: z.string().max(250_000), changedFiles: z.array(changedFileSchema).max(25) });
export const prContextRequestSchema = z.object({ prUrl: z.string().min(1).max(2_048) });
export const prContextSchema = z.object({ owner: z.string(), repo: z.string(), number: z.number().int().positive(), title: z.string(), agentsMarkdown: z.string().nullable(), agentsPath: z.string().nullable() });
export const findingSchema = z.object({ id: z.string(), requirementQuote: z.string(), specLine: z.number().int().positive(), filePath: z.string(), line: z.number().int().positive(), diffHunk: z.string(), violationType: z.string(), action: z.string(), source: z.enum(["deterministic", "llm"]), confidence: z.enum(["high", "low"]), preExisting: z.boolean() });
export const verdictSchema = z.enum(["approved", "approved_with_warnings", "changes_required", "merge_blocked"]);
export const analysisResultSchema = z.object({ snapshot: prSnapshotSchema, contract: compiledContractSchema, findings: z.array(findingSchema), verdict: verdictSchema, complianceScore: z.number().int().min(0).max(100), diagnostics: z.array(z.string()), judgmentUnavailable: z.boolean(), providerStatus: z.enum(["nvidia", "gemini", "ollama", "deterministic-only", "fallback"]).optional() });
export const analyzeRequestSchema = z.object({ prUrl: z.string().min(1).max(2_048), compiledContract: compiledContractSchema });
export type ContractRule = z.infer<typeof contractRuleSchema>; export type CompiledCheck = z.infer<typeof compiledCheckSchema>; export type CompiledContract = z.infer<typeof compiledContractSchema>; export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>; export type PRSnapshot = z.infer<typeof prSnapshotSchema>; export type Finding = z.infer<typeof findingSchema>; export type Verdict = z.infer<typeof verdictSchema>; export type AnalysisResult = z.infer<typeof analysisResultSchema>;