# Parallel implementation with Codex

This setup configures development assistants, not agents inside the product.
The project configuration allows up to three concurrent subagent threads plus the
coordinator. Host limits and managed policies still apply. Models and reasoning
inherit from the parent session; no model or permission escalation is configured.

## Start a task

Open a new Codex session in this trusted repository after these files are present.
Project configuration may be skipped in untrusted projects. Existing sessions
should not be assumed to reload configuration or instructions.

Example prompt:

> Implement [feature] using parallel subagents. Read docs/parallel-agents.md.
> Agree on contracts first, assign api_worker and extension_worker disjoint files,
> and have safety_reviewer review the integrated changes. Keep shared files with
> the coordinator. Run the configured checks and report the results.

The roles live in `.codex/agents/`. If the client's delegation tool cannot select
custom roles, the coordinator must pass the corresponding role instructions in
the delegated task. If subagent tools are unavailable, report that limitation and
perform the work sequentially; do not pretend parallel execution occurred.

## Ownership and ordering

1. Read the working tree status, relevant instructions, product brief, and ADRs.
   Establish the base revision and identify pre-existing edits and active sessions.
2. Split only independent work. Give each worker a concrete outcome, exact allowed
   files, interfaces, acceptance criteria, and scoped verification commands derived
   from repository configuration. Record ownership in the coordinator's task plan.
3. The coordinator owns `packages/contracts`, root configuration, manifests,
   lockfiles, CI, agent instructions, and shared documentation unless explicitly
   handed off to one worker. Settle interface changes before dependent workers
   implement them. A directory-based role is not blanket permission to edit it.
4. Run independent API and extension work in parallel. Workers request changes
   outside their assignment. Never give two writers the same file, including tests.
   Subagents must not delegate further; use only the workers needed for the task.
5. Wait for writers to finish, inspect their diffs, then give the integrated scope
   to the reviewer. Early read-only exploration may run alongside implementation,
   but does not replace review of the final changes.
6. The coordinator handles integration and runs the formatter, linter, type checker,
   tests, and build relevant to the change. Use `npm run check` for integrated code
   changes after confirming the scripts. Report actual outcomes and unresolved risks.

## Another session is running

Subagents can share the same checkout. File assignments are coordination rules,
not filesystem locks. A clean Git status does not prove that a path is unowned.
Independent sessions do not automatically share ownership plans or these updates.

Prefer a separate Git worktree and branch for each independent implementation
session. Start from an agreed committed baseline: a worktree does not include
uncommitted or untracked work from the original checkout. Do not commit, stash,
reset, clean, switch branches, or copy another session's unfinished work to create
that baseline. If required code exists only in the other session's working tree,
wait for its handoff or agree on explicit non-overlapping ownership.

In a shared checkout, treat other sessions' dirty files as unavailable for writing
unless ownership has been explicitly handed off. If ownership is unknown, continue
read-only investigation or use an isolated checkout. Re-read assigned files before
editing. On unexpected concurrent edits, stop writing the affected files and
coordinate instead of overwriting or reverting them.

Only the coordinator may run dependency installation, repository-wide formatting,
or builds that share output directories, and only when the checkout is exclusively
owned or those operations are coordinated with the other session. Workers can run
scoped checks only when their caches and outputs cannot interfere with other work.
Do not stop another session's processes. Use separate ports and output paths for
concurrent development servers and browser tests.

## Verification and references

`codex --version` identifies the installed CLI. `codex features list` checks that
the CLI can load configuration, but does not prove custom roles were selected or
that a client honors project settings. A new-session smoke test can request two
read-only subagents to summarize API and extension boundaries, then consolidate
their results without changing files. In the CLI, `/agent` exposes agent threads.

Subagents use additional tokens. Three workers is a ceiling, not a target.
See the [official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)
for role discovery, configuration, inheritance, and client support.
