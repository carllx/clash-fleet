# Clash Fleet

Clash Fleet 是用于 Clash Verge Rev / Mihomo 的多设备配置分发、部署与诊断工具链。

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses standard 5 canonical triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context documentation layout (`CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.

### Cross-host Git handoff

Multi-host development discipline (macOS & Windows). Remote GitHub refs are the handoff authority; never assume the other host's local clone is current. Start with `git fetch origin` on a clean working tree; hand off with fixed pushed SHAs. See `docs/agents/cross-host-git-handoff.md`.

### Context budget & 600-line guard

600 lines is a mandatory decomposition review threshold (not a mechanical limit) for handwritten code and Agent-facing docs. Prefer early budgets (`<= ~250` for guidance, `<= ~400` for code). See `docs/agents/context-budget-guard.md`.

