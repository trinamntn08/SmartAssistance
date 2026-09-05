# Development guide

## Prerequisites

- Git
- Runtime and package-manager prerequisites: to be selected in the first
  implementation ADR

## Local setup

1. Clone the repository.
2. Copy `.env.example` to `.env` when local configuration is introduced.
3. Install dependencies with the package manager committed by the project.
4. Run the project's documented validation command before opening a pull request.

## Quality commands

The executable toolchain has not been selected. When it is selected, document
the exact commands here and keep them consistent with CI:

| Check | Command |
| --- | --- |
| Format | To be defined |
| Lint | To be defined |
| Type check | To be defined |
| Unit tests | To be defined |
| Integration tests | To be defined |
| Build | To be defined |

## Configuration

- Commit safe defaults and variable names in `.env.example`.
- Store developer secrets only in ignored local files or an approved secret
  manager.
- Fail fast when required configuration is missing or invalid.
- Never use production credentials in local development or automated tests.

## Test strategy

Keep fast unit tests close to domain behavior. Add integration tests at external
boundaries and a small number of end-to-end tests for critical user workflows.
When AI behavior is added, maintain deterministic contract tests plus a versioned
evaluation set for quality, safety, latency, and cost.
