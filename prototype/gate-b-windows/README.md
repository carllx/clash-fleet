# Prototype: Gate B Windows Platform-Delta Probe

This directory contains the synthetic fixtures and bounded live-path probe script used to verify Windows-specific platform deltas for Clash Verge Rev (CVR) configuration deployment.

## Files

- `fixtures/valid_witness_script.js`: Minimal synthetic valid witness script conforming to CVR's Boa runtime contract.
- `probe.py`: Controlled, fail-closed probe script testing:
  1. Direct write overwrite to active `profiles/Script.js`.
  2. Atomic replacement via `os.replace`.
  3. Bounded passive observation for auto-apply reactivity.

## Safety Guarantees & Fail-Closed Semantics

- **Pre-flight Baseline Backup**: Requires verified byte-for-byte baseline backup of `profiles/Script.js` with pre-flight SHA-256 assertion (`d3e3955588966758037c5a72753eb8cd4afdb72940d22d5d0abd0ad36aa10ba5`).
- **Unconditional Fail-Closed Restoration**: All write/replace experiments run enclosed within a `try...finally` block. Upon normal completion or any exception/interruption, the `finally` block unconditionally reverts `profiles/Script.js` from verified baseline bytes without requiring manual operator intervention.
- **Post-Restoration Assertion**: Re-computes the SHA-256 hash of `profiles/Script.js` after restoration. If any mismatch or missing file is detected, the process terminates immediately with an explicit non-zero exit code (`sys.exit(2)`).
- **Zero Credential Exposure**: No personal subscriptions, tokens, secrets, or proxy credentials are used in fixtures.
