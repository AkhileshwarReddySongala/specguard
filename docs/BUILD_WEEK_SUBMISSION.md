# OpenAI Build Week submission packet

## Category

**Developer Tools.** SpecGuard is a governance tool for agent-written JavaScript and TypeScript pull requests. It connects a repository contract to changed code and returns an evidence-backed merge verdict.

## Devpost form

Use this packet to fill the OpenAI Build Week form. The repository and live demo entries below are ready; replace every bracketed personal or session value before submitting.

| Devpost field | Value |
| --- | --- |
| Submitter type | `[Individual / Team of Individuals / Organization]` |
| Country of residence | `[Your country]` |
| Category | `Developer Tools` |
| Code repository | `https://github.com/AkhileshwarReddySongala/specguard` |
| /feedback Session ID | `[Paste the Session ID from the Codex session where the core implementation was built]` |
| Live project URL | `https://specguard-sepia.vercel.app` |
| Project URL / judge instructions | See [Judge testing path](#judge-testing-path). |

## Delivery status

- [x] Public code repository: [AkhileshwarReddySongala/specguard](https://github.com/AkhileshwarReddySongala/specguard)
- [x] MIT license included
- [x] Public live demo: [specguard-sepia.vercel.app](https://specguard-sepia.vercel.app)
- [x] Credential-free deterministic proof scenarios and local test instructions
- [x] Codex collaboration record: [CODEX_COLLABORATION.md](CODEX_COLLABORATION.md)
- [ ] Public YouTube video under three minutes
- [ ] Verified `/feedback` Session ID
- [ ] Devpost submitter type and country of residence

## Project title and tagline

**Title:** SpecGuard

**Tagline:** Evidence-backed governance for agent-written pull requests.

## Project description draft

SpecGuard answers a question that ordinary code review leaves open: did this change follow the engineering rules people actually authorized?

Give SpecGuard a public GitHub pull request. It loads the repository's `AGENTS.md` contract at the PR head, compiles only a narrow set of code-owned JavaScript and TypeScript checks, and analyzes changed hunks. Each finding connects the original contract line to the exact changed file and line that caused it. The result is a merge verdict, an honest compliance score, and a coverage ledger that separates deterministic checks from AI judgment.

The deterministic layer catches explicit, high-confidence rules such as forbidden imports, protected paths, named dependency changes, restricted JavaScript syntax, and scoped API-route test requirements. Ambiguous, prose-heavy, or non-JS/TS rules stay in bounded AI judgment. Model output is grounded to an existing rule, changed file, and changed line, and it can never create executable lint configuration or a deterministic finding.

SpecGuard is built for the failure mode created by coding agents: code can look clean while still violating a team's contract. The proof demos make that visible without credentials: a forbidden import and a protected workflow change block a merge, while a missing API test produces `CHANGES REQUIRED`. For real PRs, the UI makes incomplete AI coverage explicit, including assessed, scoped-out, and unassessed rules. It never turns a partial run into an unqualified approval.

Edit this draft in your own voice before publishing it on Devpost.

## Judge testing path

The committed deterministic demos work without GitHub or AI credentials.

```bash
npm ci
npm run lint
npm test
npm run dev
```

Open `http://localhost:3000`, expand **AUTHORED DEMO SCENARIOS**, and run these in order:

1. **Proof: forbidden import** → `MERGE BLOCKED` with contract line 2 linked to `src/proof.ts:1`.
2. **Proof: protected path** → `MERGE BLOCKED` with contract line 2 linked to `.github/workflows/release.yml:1`.
3. **Proof: missing test** → `CHANGES REQUIRED` with contract line 2 linked to `app/api/health/route.ts:1`.

For a live public PR, set `GITHUB_TOKEN` and a hosted provider key in `.env.local`, paste a public GitHub PR URL, load its contract, compile it, choose **Judge relevant rules**, then analyze. The UI shows deterministic and AI coverage separately. A partial AI run is labeled `APPROVED WITH WARNINGS`, never `APPROVED`.

## How Codex contributed

Codex was used as a collaborative engineering partner to:

- build the staged Next.js API and evidence-first UI;
- tighten the compiler so only explicit JS/TS contract templates create deterministic checks;
- add proof fixtures, route tests, unit tests, and Playwright evidence-synchronization tests;
- document failure recovery for NVIDIA, Gemini, and local Ollama judgment paths.

The repository preserves this work in its commit history and a redacted session-log fixture. Before submission, retrieve the `/feedback` Session ID from the Codex session that contains the core work and confirm the session model history supports any GPT-5.6 claim made in the form or video.

For the concise engineering record, see [CODEX_COLLABORATION.md](CODEX_COLLABORATION.md).

## Three-minute demo script

**0:00–0:18 — Problem.** “AI-generated code can look review-clean while violating a rule people already wrote. SpecGuard is governance, not another code review.”

**0:18–0:55 — Proof.** Run **Proof: forbidden import**. Point out the blocked verdict, deterministic badge, contract rule, and changed `lodash` import.

**0:55–1:20 — Evidence.** Click the finding. Explain that the contract and changed-code panes synchronize to the exact rule and diff line, so the verdict is inspectable rather than a model opinion.

**1:20–1:42 — Severity.** Run **Proof: missing test**. Explain that a `SHOULD` test requirement produces `CHANGES REQUIRED`, while a `MUST` prohibition blocks the merge.

**1:42–2:10 — Real workflow.** Paste a public PR. Show SpecGuard loading `AGENTS.md` at the PR head, or the explicit pasted/sample choice when no contract exists.

**2:10–2:32 — Honest AI coverage.** Show **Judge relevant rules**. Explain that deterministic checks always run, while ambiguous rules receive grounded AI judgment in paced batches. Point to assessed, scoped-out, and unassessed counts.

**2:32–2:50 — Reliability.** Explain that a malformed or timed-out NVIDIA batch retries, splits into smaller batches, then uses Gemini or local development fallback. Any remaining rules stay visible as unassessed.

**2:50–3:00 — Codex and close.** State how Codex helped build and test the product. Only say that GPT-5.6 was used after verifying it in the `/feedback` session. Close with: “SpecGuard proves whether agent-written code matches what humans authorized.”

## Final pre-submit checklist

- [ ] Replace the submitter type, country, and `/feedback` Session ID placeholders.
- [ ] Record and publish a public YouTube video under three minutes with voiceover covering the product, Codex, and verified GPT-5.6 use.
- [x] Confirm the public repository includes its MIT license.
- [ ] If the repository stays private, share it with `testing@devpost.com` and `build-week-event@openai.com`.
- [ ] Run `npm run lint`, `npm test`, `npx tsc --noEmit`, `npm run test:e2e`, and `npm run build`.
- [ ] Confirm every team member is added to Devpost and has accepted the invitation.
- [ ] Edit the project description into your own voice, then submit before the Devpost deadline.
