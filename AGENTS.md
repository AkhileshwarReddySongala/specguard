# SpecGuard Contract

- Do not add runtime dependencies without a matching test and an explicit justification in the PR description.
- Do not change `.github/workflows/` in this hackathon build.
- Every API route must validate request bodies with Zod.
- Every deterministic finding must preserve its evidence fields verbatim from the engine.
- Keep the public demo usable without API credentials by maintaining the committed fallback scenarios.
