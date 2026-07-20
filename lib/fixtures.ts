import type { PRSnapshot } from "@/lib/contracts";

export const SAMPLE_CONTRACT = `# Demo contract
- Do not add lodash or any new runtime dependency.
- Never modify .github/workflows/ during this change.
- Every API route must include a matching test.
- Do not use eval( in application code.`;

export const CURATED_PRESETS = [
  { url: "https://github.com/agentsmd/agents.md/pull/216", label: "agents.md", detail: "Tooling documentation" },
  { url: "https://github.com/cloudflare/agents/pull/1963", label: "Cloudflare Agents", detail: "Reconnect-stream fix" },
  { url: "https://github.com/actualbudget/actual/pull/8521", label: "Actual Budget", detail: "Custom-report fix" },
] as const;

const demoSnapshots: Record<string, PRSnapshot> = {
  "demo://blocked": { owner: "specguard", repo: "demo", number: 1, title: "Add an unauthorized dependency", unifiedDiff: "@@ -1,3 +1,4 @@\n import React from 'react';\n+import _ from 'lodash';\n export default function App() {}", changedFiles: [{ path: "app/page.tsx", status: "modified", content: "import React from 'react';\nimport _ from 'lodash';\nexport default function App() {}" }] },
  "demo://warnings": { owner: "specguard", repo: "demo", number: 2, title: "Small UI change without a test", unifiedDiff: "@@ -1 +1,2 @@\n export const title = 'SpecGuard';\n+export const subtitle = 'Governance';", changedFiles: [{ path: "app/title.ts", status: "modified", content: "export const title = 'SpecGuard';\nexport const subtitle = 'Governance';" }] },
  "demo://approved": { owner: "specguard", repo: "demo", number: 3, title: "Document the demo", unifiedDiff: "@@ -1 +1,2 @@\n # SpecGuard\n+Evidence-backed governance.", changedFiles: [{ path: "README.md", status: "modified", content: "# SpecGuard\nEvidence-backed governance." }] },
};

export function getDemoSnapshot(url: string) { return demoSnapshots[url]; }
export const DEMOS = [
  { id: "demo://blocked", label: "Blocked dependency" },
  { id: "demo://warnings", label: "Missing test" },
  { id: "demo://approved", label: "Pre-existing only" },
];