# SmartAssistance

SmartAssistance is a new AI-assisted product. The repository currently contains
the project foundation; product scope and implementation technology are
intentionally undecided until the first architecture decision is recorded.

## Start here

1. Complete [the project brief](docs/product/PROJECT_BRIEF.md) with the problem,
   users, measurable outcomes, and initial scope.
2. Record the runtime and delivery architecture with
   [the ADR template](docs/decisions/0000-template.md).
3. Add the first small vertical slice under `src/` and its tests under `tests/`.
4. Replace the placeholder quality commands in
   [the development guide](docs/development.md) when the toolchain is selected.

## Repository map

```text
.
|-- AGENTS.md                 Instructions for coding agents
|-- docs/
|   |-- architecture/         System boundaries and diagrams
|   |-- decisions/            Architecture decision records (ADRs)
|   `-- product/              Product goals and scope
|-- src/                      Product source code
`-- tests/                    Automated tests
```

## Working agreements

- Keep secrets out of Git. Copy `.env.example` to `.env` for local values.
- Prefer small, reviewable changes tied to an explicit outcome.
- Record consequential and hard-to-reverse choices as ADRs.
- Add automated tests with behavior changes once a test runner is selected.
- Do not introduce a framework only to fill the empty repository.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and
[SECURITY.md](SECURITY.md) for security reporting.

## License

No license has been selected. Until one is added, reuse rights are not granted.
