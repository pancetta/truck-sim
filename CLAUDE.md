## Code review

Always run a ponytail review (`/ponytail:ponytail-review`) on new code before considering it done.

Keep review effort in proportion to risk (this overrides the "fix every finding, re-review every fix" loop in the supermatt implement/code-review skills):

- Per ticket: one fresh-context QA pass and one code review, with depth set by the diff's risk.
- Fix P0–P2 findings. Fix P3s in one batch if they're cheap, otherwise list them; don't re-review them.
- Run follow-up QA or review only when a fix changes player-visible behaviour or the CI/deploy path, and scope it to that fix.
- Don't harden test-only guards against hypothetical misuse. Keep them simple and mark their limits with a `shortcut:` comment.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on pancetta/truck-sim via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: bug, enhancement, needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### External peers

host-only: no external peer CLI is called. See `docs/agents/cross-model.json`.
