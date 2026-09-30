# Prototype: Gate B Windows Platform-Delta Probe

This directory contains the synthetic fixtures and bounded live-path probe script used to verify Windows-specific platform deltas for Clash Verge Rev (CVR) configuration deployment.

## Files

- `fixtures/valid_witness_script.js`: Minimal synthetic valid witness script conforming to CVR's Boa runtime contract.
- `probe.py`: Controlled, reversible probe script testing:
  1. Direct write overwrite to active `profiles/Script.js`.
  2. Atomic replacement via `os.replace`.
  3. Preservation of NTFS ACLs and permissions.
  4. Bounded passive observation for auto-apply reactivity.

## Safety Guarantees

- All probes require a byte-for-byte verified backup of `profiles/Script.js` before execution.
- No personal subscriptions, tokens, secrets, or proxies are used in fixtures.
- The active runtime configuration is restored to exact baseline SHA-256 upon test completion.
