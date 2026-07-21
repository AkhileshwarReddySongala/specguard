# Codex collaboration record

SpecGuard was developed in Codex through an iterative collaboration between the project owner and Codex. The owner set the product direction and acceptance criteria: evidence-first governance for agent-written code, a narrow deterministic enforcement boundary, public-PR analysis, and honest treatment of incomplete AI coverage.

## What Codex helped implement

- The staged Next.js workflow: public PR context, contract compilation, and streamed analysis.
- Code-owned JavaScript and TypeScript checks for explicit imports, syntax, protected paths, dependencies, and scoped route-to-test requirements.
- An evidence UI that links an exact contract line to the exact changed-code line.
- Rate-aware NVIDIA and Gemini judgment recovery, while keeping model output unable to create executable enforcement configuration.
- Credential-free proof scenarios, Vitest route/unit coverage, and Playwright interaction coverage.
- Redacted session-log parsing for the self-governance demo; production does not access a developer's local Codex files.

## Engineering decisions preserved in the product

1. Deterministic findings are produced only from explicit code-owned templates and preserve their engine evidence verbatim.
2. Prose-heavy, ambiguous, non-JS/TS, documentation, and Python rules remain bounded AI judgment rather than being misrepresented as deterministic checks.
3. A partial AI run is never a full approval: it reports assessed, scoped-out, and unassessed rules and caps the score below 80.
4. The three authored proof scenarios remain usable without GitHub or AI credentials.

## Build Week verification

The public repository includes the implementation history and an MIT license. Before submitting to Devpost, the project owner must add the verified `/feedback` Session ID from the Codex session containing the core work and verify that the session supports any statement about GPT-5.6 in the video or form. This repository deliberately does not invent a session ID or make an unverified model claim.

For the complete judge path and video outline, see [BUILD_WEEK_SUBMISSION.md](BUILD_WEEK_SUBMISSION.md).
