# Security policy

## Report a vulnerability

Do not disclose suspected vulnerabilities in a public issue. Send the repository
owner a private report containing:

- the affected component and version or commit;
- steps to reproduce or a minimal proof of concept;
- expected impact;
- any suggested mitigation.

Do not include real credentials, personal data, or third-party secrets in the
report. The project owner should acknowledge the report, agree on a disclosure
timeline, and publish remediation details after a fix is available.

## Baseline requirements

- Never commit secrets. Use local environment variables and secret stores in
  deployed environments.
- Minimize collection and retention of user and model interaction data.
- Redact sensitive values in logs, traces, tests, and support artifacts.
- Validate model-produced tool arguments before execution and require explicit
  authorization for consequential actions.
- Pin and regularly review production dependencies after a toolchain is chosen.
