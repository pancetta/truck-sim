## Code review

Always run a ponytail review (`/ponytail:ponytail-review`) on new code before considering it done.

Keep review effort in proportion to risk (this overrides the "fix every finding, re-review every fix" loop in the supermatt implement/code-review skills):

- Per ticket: one fresh-context QA pass and one code review, with depth set by the diff's risk.
- Fix P0–P2 findings. Fix P3s in one batch if they're cheap, otherwise list them; don't re-review them.
- Run follow-up QA or review only when a fix changes player-visible behaviour or the CI/deploy path, and scope it to that fix.
- Don't harden test-only guards against hypothetical misuse. Keep them simple and mark their limits with a `shortcut:` comment.

## Testing on iPad

The iPad simulator runs Safari on the Mac's GPU, so its frame times say nothing about a real iPad, and running it slows the owner's machine.

- Default QA: the Vitest seams plus Chrome in the built-in browser. Perf numbers come from Chrome `?perf` and are relative checks only.
- Boot the simulator only for a ticket that changes touch input, HUD layout, iPad-specific CSS, the loading or home-screen/fullscreen flow, or uses a rendering feature that may behave differently in Safari. Shut it down (`xcrun simctl shutdown all`) right after that check.
- Never record simulator frame times as iPad performance. Real-iPad numbers come from the owner's `?perf&auto` run.
- Run one heavy process at a time (simulator, dev server, soak tests), and stop dev servers you started when you're done.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on pancetta/truck-sim via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: bug, enhancement, needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### External peers

host-only: no external peer CLI is called. See `docs/agents/cross-model.json`.
