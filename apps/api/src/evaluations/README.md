# Rewrite evaluations

`cases.ts` is a versioned initial corpus of 20 synthetic drafts. It covers both
writing modes and the two improvement styles, names, numbers, dates, identifiers, links,
email addresses, mentions, emoji, negation, conditional commitments, paragraph
breaks, French, Spanish, Japanese, Chinese, Arabic, mixed-language passages,
instruction-like input, and a draft near the 10,000-character input limit.

This is initial coverage, not a representative benchmark of every supported
language or writing task. Update the corpus version when cases or their checks
change. Compare results with the reported model and prompt version; generation
settings and evaluation limits also need to be recorded alongside a comparison.

## What the automated checks measure

Each case specifies literal substrings, tokens, forbidden phrases, or paragraph
counts. Protected text must occur the same number of times as in the source.
Token checks use Unicode letter/number boundaries to reject changes such as
`17` to `170`. Substring checks support names embedded in CJK text and exact URL
characters. Paragraph checks count paragraphs separated by blank lines.

These rules are intentionally narrow and case-sensitive. They do not prove
meaning preservation, correct translation, grammatical quality, naturalness,
relative paragraph order, or absence of all invented commitments. A URL can
retain a protected substring while acquiring an unsafe suffix. A forbidden
phrase cannot cover all paraphrases. Exact phrase protection can reject valid
wording changes. An unchanged ungrammatical draft can pass every automated check.

`humanReview` identifies what a reviewer must assess for each case. Review both
source and candidate in memory using synthetic drafts, checking meaning,
negation, conditions, requested operation, language, and tone. Record ratings
separately from draft content. A broader human-reviewed corpus and an agreed
rating protocol are still required before assessing the product brief's 99%
protected-fact and 85% human-preference release thresholds. This corpus and its
unit tests do not establish either threshold.

## Offline verification

The regular Vitest suite checks evaluator failure cases and runs the harness
against fake providers. Tests never make live model requests. In particular,
tests verify changed names/numbers, strengthened commitments, merged paragraphs,
invalid fixtures, sequential execution, deadline/cancellation handling, and
redacted error reports.

## Opt-in live run

Use Node.js 24, configure `OPENAI_API_KEY` and `OPENAI_MODEL` in the development
environment, then explicitly authorize paid synthetic requests. From the
repository root in PowerShell:

```powershell
$env:RUN_LIVE_REWRITE_EVALS = "1"
npm run eval:rewrites
Remove-Item Env:RUN_LIVE_REWRITE_EVALS
```

The runner uses the configured provider adapter and rewrite service. It submits
the fixtures sequentially, makes at most 20 requests, performs no automatic
retries, and sends no tools. The adapter requests `store: false`; provider
retention policies still apply. A cancelled or timed-out run stops before the
next case. The adapter enforces the configured per-request deadline, up to 15
seconds, while the suite has a maximum five-minute total deadline.

Optional environment variables can reduce the run's budgets:

| Variable | Default | Maximum |
| --- | --- | --- |
| `REWRITE_EVAL_MAX_CASES` | 20 | 20 |
| `REWRITE_EVAL_MAX_OUTPUT_TOKENS` | 8192 | 8192 |
| `REWRITE_EVAL_TIMEOUT_MS` | 300000 | 300000 |

The output budget is also capped by `OPENAI_MAX_OUTPUT_TOKENS`. The default full
run permits at most 163,840 output tokens across its 20 requests, plus input
tokens; it is a token bound, not a currency estimate. A lower case count selects
the first cases, so it is a smoke test and omits later multilingual/long cases.
A low output limit can cause the long case to fail as incomplete; that failure
must remain visible rather than be silently skipped. Incomplete and failed
requests can incur charges without returning usage, so `knownUsage` is only
usage returned for successful provider responses.

Standard output contains a JSON report with fixture IDs, pass/fail, invariant
indices and safe reason codes, model, prompt/corpus version, token usage when
available, and duration. It excludes draft text, rewritten text, API keys,
provider error messages, and provider response bodies. The runner writes no
files. Failed provider calls remain failed cases; they are not included in the
invariant denominator because no usable rewrite was evaluated. A run exits
successfully only when every selected case finishes and passes its automated
checks. This success is not a release-quality verdict.
