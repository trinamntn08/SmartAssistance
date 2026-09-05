# Repository agent instructions

## Mission and current state

SmartAssistance is a privacy-first Chrome writing assistant. The product brief is
the source of truth for user needs and scope. Architecture decision records
(ADRs) are the source of truth for consequential technical choices.

The repository uses Node.js 24, npm workspaces, TypeScript, Chrome Manifest V3,
esbuild, Biome, and Vitest. The API is stateless and keeps OpenAI credentials out
of the browser; see ADR-0001.

These instructions apply to the entire repository. A more deeply nested
`AGENTS.md` or `AGENTS.override.md` may add instructions for its directory.

## Before making changes

- Read `README.md`, `docs/product/PROJECT_BRIEF.md`, and relevant ADRs.
- Inspect the working tree and preserve unrelated user changes.
- Derive build, format, lint, type-check, and test commands from committed tool
  configuration. Never guess commands or claim checks that were not run.
- Make assumptions explicit when requirements are incomplete. Ask only when a
  choice would materially change product behavior, security, cost, or scope.

## Architecture rules

- Organize code around product capabilities and clear boundaries.
- Keep core business rules independent from UI, storage, model vendors, and
  external services. Connect those concerns through explicit interfaces.
- Put configuration in environment variables or typed configuration files;
  never hard-code secrets or environment-specific endpoints.
- Treat model prompts, tool schemas, safety policies, and evaluation cases as
  versioned product artifacts when AI behavior is implemented.
- Wrap external AI providers behind an adapter. Define timeouts, retries, cost
  limits, observability, and deterministic fallback behavior at that boundary.
- Prefer one small end-to-end feature over speculative layers and abstractions.
- Record significant dependency, data, security, deployment, or architecture
  decisions in `docs/decisions/`.

## Standard commands

- Install: `npm ci`
- Development API: `npm run dev:api`
- Development extension build: `npm run dev:extension`
- Format: `npm run format`
- Complete validation: `npm run check`

## Quality and security

- Add tests for changed behavior, important failure paths, and trust boundaries.
- Validate untrusted input at system boundaries and use least-privilege access.
- Do not log secrets, credentials, raw sensitive content, or unnecessary personal
  data. Use redacted or synthetic fixtures in tests and documentation.
- Keep production dependencies minimal and justify new ones in the change.
- Update documentation when interfaces, setup, behavior, or architecture change.

## Completion criteria

- Run the configured formatter, linter, type checker, tests, and build relevant to
  the change.
- Review the diff for accidental generated files, secrets, and unrelated edits.
- Report what changed, which checks ran and their results, and any remaining risk
  or follow-up. Do not describe planned work as completed work.

## Code review rules

- Flag code that bypasses a documented boundary or contradicts an accepted ADR.
- Flag secrets, sensitive-data logging, unbounded model/tool loops, missing
  external-call timeouts, and unsafe handling of model-generated actions.
- Require tests for behavior changes unless the change is documentation-only.

## Parallel implementation

- Use subagents for independent implementation or review work when it materially
  helps. Keep small or tightly coupled changes with one agent.
- Before delegating, read [the parallel-agent workflow](docs/parallel-agents.md).
  Assign exclusive file ownership, settle shared contracts first, and preserve
  other sessions' work. Prefer separate worktrees for independent sessions.
- Use the project roles in `.codex/agents/` when supported; otherwise pass their
  instructions explicitly. Use at most three concurrent subagents and no nested
  delegation. The coordinator owns integration and final validation.
