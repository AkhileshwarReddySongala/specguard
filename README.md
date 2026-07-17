# SpecGuard

SpecGuard proves whether AI-written code matches what humans authorized. It compiles an `AGENTS.md` contract, analyzes a public GitHub pull request, and returns a requirement-to-diff evidence chain with a merge recommendation.

## Run locally

```bash
npm install
copy .env.example .env.local
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
## Live validation record

- Target: [openai/codex#31939](https://github.com/openai/codex/pull/31939), validated July 17, 2026.
- Contract discovery: 1.5 seconds; contract size: 22,485 characters.
- NVIDIA compiler: 30 grounded judgment rules in 42.2 seconds.
- NVIDIA judgment did not return a valid grounded result within the budget; SpecGuard returned deterministic partial findings in 46.5 seconds, with an honest judgment unavailable diagnostic.

