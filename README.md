# SpecGuard

SpecGuard proves whether AI-written code matches what humans authorized. It compiles an `AGENTS.md` contract, analyzes a public GitHub pull request, and returns a requirement-to-diff evidence chain with a merge recommendation.

## Run locally

```bash
npm install
copy .env.example .env.local
npm run lint
npm test
npm run dev
```

Open `http://localhost:3000`. The committed demo scenarios work without credentials. For live AI judgment, use Ollama locally or set NVIDIA credentials. Production uses NVIDIA NIM first and Gemini only when both Gemini variables are configured.

## Environment

- `GITHUB_TOKEN`: server-side token for public PR retrieval.
- `NVIDIA_API_KEY`, `NVIDIA_MODEL`: production primary. Default model is `google/gemma-4-31b-it`.
- `GEMINI_API_KEY`, `GEMINI_MODEL`: optional production fallback. `GEMINI_MODEL` has no default by design.
- `OLLAMA_*`: development-only local inference. Production never attempts localhost.

## Verification

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
npm run test:e2e
```

The core contract is staged: `/api/compile` streams only a final validated contract suitable for `/api/analyze`. Every API request is Zod-validated. Deterministic findings retain evidence supplied by the engine and pre-existing findings do not affect verdicts or scores.

## Codex collaboration and session governance

This project was built with Codex. The self-governance demo is intentionally fixture-based and redacted: production never reads a developer's local Codex directory. Session JSONL is parsed only when supplied to the app, then shown as the same contract-to-evidence chain used for PR findings.

## Deploy to Vercel

Import this repository into Vercel, add the production environment variables above, and deploy `master`. Do not add Ollama variables to Vercel. The public demo remains usable if no provider credentials are configured because fixtures and deterministic partial results are committed.

## Video outline

1. Show one `AGENTS.md` sentence.
2. Run the blocked dependency scenario: the code looks review-clean, but was not authorized.
3. Click its finding to connect contract text to changed code.
4. Paste a public PR and show contract discovery or the explicit sample-contract choice.
5. Close with the redacted Codex session-governance demo.

## Build Week submission

The judge-ready submission packet, including Devpost field copy, a credential-free test path, a three-minute video script, and final checks, is in [docs/BUILD_WEEK_SUBMISSION.md](docs/BUILD_WEEK_SUBMISSION.md).
## Evidence boundary and validation records

SpecGuard's deterministic compiler is deliberately narrow and entirely code-owned. It only emits JS/TS-safe checks from explicit contract templates: restricted imports or syntax, protected paths, named dependency changes, and scoped route-to-test requirements. Comments, documentation, Python-only rules, and ambiguous requirements stay as bounded AI judgment rules. Model output can report a grounded finding, but it cannot create or configure a deterministic check.

The committed proof scenarios work without GitHub or AI credentials and verify exact evidence coordinates through the live local routes:

| Scenario | Expected verdict | Evidence |
| --- | --- | --- |
| Forbidden import | Merge blocked | contract line 2 -> `src/proof.ts:1` |
| Protected path change | Merge blocked | contract line 2 -> `.github/workflows/release.yml:1` |
| Missing API test | Changes required | contract line 2 -> `app/api/health/route.ts:1` |

Observed public-PR judgment runs are recorded as partial rather than treated as approvals:

| PR | Provider outcome | Coverage | Verdict |
| --- | --- | --- | --- |
| [apache/airflow#70098](https://github.com/apache/airflow/pull/70098) | NVIDIA invalid output and timeout recovery | 107/115 selected assessed; 42 scoped out; 8 unassessed | Approved with warnings |
| [openai/codex#31917](https://github.com/openai/codex/pull/31917) | NVIDIA invalid output and timeout recovery | 94/110 selected assessed; 31 scoped out; 16 unassessed | Approved with warnings |

An incomplete AI run is always labeled `APPROVED WITH WARNINGS` and is capped below 80. A full approval requires complete selected AI coverage; deterministic merge blocks remain effective even if AI judgment is partial. The current release does not claim a verified real-PR blocked, changes-required, or fully covered approval record until those runs complete successfully.
