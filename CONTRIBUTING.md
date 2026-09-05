# Contributing

## Before implementation

1. Confirm the change has a clear user or operational outcome.
2. Read the project brief and relevant architecture decisions.
3. For a consequential or hard-to-reverse choice, propose an ADR before building.

## Change workflow

1. Create a short-lived branch from `main`.
2. Make the smallest cohesive change that satisfies the acceptance criteria.
3. Add or update tests and documentation with the implementation.
4. Run every quality check defined by the selected toolchain.
5. Review the diff for secrets, generated artifacts, and unrelated changes.
6. Open a pull request using the repository template.

Use concise Conventional Commit subjects where practical, for example
`feat: add conversation history` or `docs: define data retention policy`.

## Definition of done

- Acceptance criteria are met.
- Relevant format, lint, type, test, and build checks pass.
- Failure paths and trust boundaries have meaningful test coverage.
- Setup, interfaces, and architecture documentation are current.
- No secrets or unnecessary sensitive data are present in code, tests, or logs.
- The pull request explains risks, tradeoffs, and follow-up work.
