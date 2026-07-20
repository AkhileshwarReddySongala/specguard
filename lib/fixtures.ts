import type { PRSnapshot } from "@/lib/contracts";

export const SAMPLE_CONTRACT = `# Demo contract
- Do not add lodash or any new runtime dependency.
- Never modify .github/workflows/ during this change.
- Every API route should include a matching test.
- Do not use eval( in application code.`;

export const DEMO_CONTRACTS: Record<string, string> = {
  "demo://proof": "# Deterministic proof contract\n- Never import lodash.",
  "demo://protected-path": "# Protected path proof contract\n- Never modify .github/workflows/.",
  "demo://missing-test": "# Test requirement proof contract\n- Every API route should include a matching test.",
};

export const CURATED_PRESETS = [
  { url: "https://github.com/agentsmd/agents.md/pull/216", label: "agents.md", detail: "Tooling documentation" },
  { url: "https://github.com/cloudflare/agents/pull/1963", label: "Cloudflare Agents", detail: "Reconnect-stream fix" },
  { url: "https://github.com/actualbudget/actual/pull/8521", label: "Actual Budget", detail: "Custom-report fix" },
] as const;

const demoSnapshots: Record<string, PRSnapshot> = {
  "demo://proof": { owner: "specguard", repo: "proof", number: 1, title: "Proof: forbidden lodash import", unifiedDiff: "diff --git a/src/proof.ts b/src/proof.ts\n--- a/src/proof.ts\n+++ b/src/proof.ts\n@@ -1 +1,2 @@\n+import lodash from 'lodash';\n export const proof = true;", changedFiles: [{ path: "src/proof.ts", status: "modified", content: "import lodash from 'lodash';\nexport const proof = true;" }] },
  "demo://protected-path": { owner: "specguard", repo: "proof", number: 2, title: "Proof: protected workflow changed", unifiedDiff: "diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml\n--- a/.github/workflows/release.yml\n+++ b/.github/workflows/release.yml\n@@ -1 +1,2 @@\n name: release\n+run: echo changed", changedFiles: [{ path: ".github/workflows/release.yml", status: "modified", content: "name: release\nrun: echo changed" }] },
  "demo://missing-test": { owner: "specguard", repo: "proof", number: 3, title: "Proof: API route changed without test", unifiedDiff: "diff --git a/app/api/health/route.ts b/app/api/health/route.ts\n--- a/app/api/health/route.ts\n+++ b/app/api/health/route.ts\n@@ -0,0 +1,3 @@\n+export async function GET() {\n+  return Response.json({ ok: true });\n+}", changedFiles: [{ path: "app/api/health/route.ts", status: "added", content: "export async function GET() {\n  return Response.json({ ok: true });\n}" }] },
  "demo://blocked": { owner: "specguard", repo: "demo", number: 4, title: "Add an unauthorized dependency", unifiedDiff: "@@ -1,3 +1,4 @@\n import React from 'react';\n+import _ from 'lodash';\n export default function App() {}", changedFiles: [{ path: "app/page.tsx", status: "modified", content: "import React from 'react';\nimport _ from 'lodash';\nexport default function App() {}" }] },
  "demo://warnings": { owner: "specguard", repo: "demo", number: 5, title: "Small UI change without a test", unifiedDiff: "@@ -1 +1,2 @@\n export const title = 'SpecGuard';\n+export const subtitle = 'Governance';", changedFiles: [{ path: "app/title.ts", status: "modified", content: "export const title = 'SpecGuard';\nexport const subtitle = 'Governance';" }] },
  "demo://approved": { owner: "specguard", repo: "demo", number: 6, title: "Document the demo", unifiedDiff: "@@ -1 +1,2 @@\n # SpecGuard\n+Evidence-backed governance.", changedFiles: [{ path: "README.md", status: "modified", content: "# SpecGuard\nEvidence-backed governance." }] },
};

export function getDemoSnapshot(url: string) { return demoSnapshots[url]; }
export const DEMOS = [
  { id: "demo://proof", label: "Proof: forbidden import" },
  { id: "demo://protected-path", label: "Proof: protected path" },
  { id: "demo://missing-test", label: "Proof: missing test" },
  { id: "demo://blocked", label: "Blocked dependency" },
  { id: "demo://warnings", label: "Missing test" },
  { id: "demo://approved", label: "Pre-existing only" },
];