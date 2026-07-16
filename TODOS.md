# TODOS

## GitHub App / CI integration (post-hackathon distribution)
- **What:** SpecGuard as a GitHub App or Action that comments verdicts + evidence chains on PRs automatically.
- **Why:** The real distribution channel if SpecGuard becomes a product — nobody pastes PR URLs forever, and private repos (the paying audience) need it.
- **Pros:** Turns the demo into a product; the staged API (`/compile` → `/analyze`) maps cleanly onto a CI step; supersedes paste-a-diff as the private-repo path.
- **Cons:** App registration, webhook plumbing, permissions review; meaningless until the hackathon validates the core.
- **Context (2026-07-15):** Deferred twice (office-hours design + /plan-eng-review) because Build Week judges use the hosted URL. Start from the `/analyze` route — it already takes a PR ref + checks JSON.
- **Depends on / blocked by:** Hackathon submission shipped; interest signal from judges/users.

## Partial render when the judgment pass fails
- **What:** If the GPT-5.6 judgment call fails mid-`/analyze` but the deterministic engine produced findings, render those with a "judgment checks unavailable" note instead of erroring the whole request.
- **Why:** The one failure mode in the review's table where working results get discarded; most likely to fire under judging load.
- **Pros:** ~30 minutes with CC; the deterministic-only render doubles as the Plan-A fallback UI.
- **Cons:** One more UI state; partial results need clear labeling to avoid looking like complete results.
- **Context (2026-07-15):** Flagged in /plan-eng-review failure modes. Error boundary wraps exactly one call (stage 4, judgment). User chose to capture rather than commit to hackathon scope — pull it in if day 3 runs ahead.
- **Depends on / blocked by:** Core `/analyze` route existing (day 2-3).

## Full design system + light theme (post-hackathon design debt)
- **What:** Run /design-consultation to grow the six-token Design Language seed (dark, IBM Plex Sans + JetBrains Mono, verdict palette) into a full DESIGN.md (spacing scale, component vocabulary, brand voice), and add a light theme.
- **Why:** The hackathon ships dark-only with a deliberately minimal token set — right for judging week, wrong for a real user base.
- **Pros:** The seed tokens were chosen to extend cleanly; consultation formalizes rather than replaces.
- **Cons:** Meaningless until SpecGuard has users beyond judges.
- **Context (2026-07-15):** /plan-design-review scored the plan 4/10 → 9/10 and bound the seed tokens; dark-only and seed-not-system were explicit scope calls for the 6-day build.
- **Depends on / blocked by:** Hackathon shipped; product continuing.

## LLM-adapted sample contracts (onboarding)
- **What:** When a target repo has no AGENTS.md, GPT-5.6 tailors the sample contract to the repo's detected stack before compiling — borrowed rules that target the repo's real imports, paths, and layout.
- **Why:** Every new user starts with no AGENTS.md; this upgrades the first-run journey from "illustrative banner" to "native-looking findings." Arguably the first real-product feature to build after the hackathon.
- **Pros:** Highest-value onboarding feature identified in review; pairs with the prefilled contract editor that ships in the hackathon build.
- **Cons:** Reintroduces the spec-inference risk class (an LLM step whose failures are subtle); needs its own eval corpus.
- **Context (2026-07-15):** Rejected for hackathon scope in /plan-eng-review (D7, option 4B) to protect the 6-day build; the cut-rationale was risk, not value. Becomes right when there's time to eval the adaptation quality.
- **Depends on / blocked by:** Hackathon shipped; compiler eval harness (exists as of the test matrix) extended with adaptation cases.
