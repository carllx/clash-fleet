#!/usr/bin/env python3
"""Windows Gate B File Replacement & Raw Lifecycle Probe.

Safety Guarantee:
- Pre-flight verifies that a byte-for-byte baseline backup exists with matching SHA-256.
- The entire probe executes inside a fail-closed try...finally block.
- Upon completion or any error/exception, the finally block unconditionally restores
  Script.js from baseline bytes and asserts the restored SHA-256 matches baseline.
- Any restoration failure or hash mismatch results in an immediate non-zero exit.
"""

import hashlib
import os
import sys
import time
from pathlib import Path

APPDATA_DIR = Path(os.environ.get("APPDATA", "")) / "io.github.clash-verge-rev.clash-verge-rev"
PROFILES_DIR = APPDATA_DIR / "profiles"
SCRIPT_PATH = PROFILES_DIR / "Script.js"
BACKUP_PATH = PROFILES_DIR / "Script.js.baseline_backup"
YAML_PATH = APPDATA_DIR / "clash-verge.yaml"
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "valid_witness_script.js"

EXPECTED_BASELINE_SHA256 = "d3e3955588966758037c5a72753eb8cd4afdb72940d22d5d0abd0ad36aa10ba5"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest().lower()


def run_probe():
    print("=== WINDOWS GATE B: FILE-REPLACEMENT & RAW LIFECYCLE PROBE ===")

    # 0. Safety Pre-flight Checks
    if not SCRIPT_PATH.exists():
        print(f"FAIL: Script.js not found at {SCRIPT_PATH}")
        sys.exit(1)

    # Ensure baseline backup exists and is verified
    if not BACKUP_PATH.exists():
        curr_sha = sha256_file(SCRIPT_PATH)
        if curr_sha == EXPECTED_BASELINE_SHA256:
            with open(SCRIPT_PATH, "rb") as src, open(BACKUP_PATH, "wb") as dst:
                dst.write(src.read())
            print(f"SAFETY: Auto-created baseline backup from current Script.js: {curr_sha}")
        else:
            print(f"FAIL: Baseline backup missing and Script.js SHA mismatch! ({curr_sha} != {EXPECTED_BASELINE_SHA256})")
            sys.exit(1)

    backup_sha = sha256_file(BACKUP_PATH)
    if backup_sha != EXPECTED_BASELINE_SHA256:
        print(f"FAIL: Backup SHA-256 mismatch! Got {backup_sha}, expected {EXPECTED_BASELINE_SHA256}")
        sys.exit(1)

    with open(BACKUP_PATH, "rb") as f:
        baseline_bytes = f.read()

    print(f"SAFETY: Verified baseline backup loaded ({len(baseline_bytes)} bytes, SHA-256: {backup_sha})")

    with open(FIXTURE_PATH, "rb") as f:
        witness_bytes = f.read()

    yaml_before_mtime = YAML_PATH.stat().st_mtime_ns if YAML_PATH.exists() else 0
    yaml_before_sha = sha256_file(YAML_PATH) if YAML_PATH.exists() else ""

    probe_exception = None
    results = {}

    try:
        # 1. Test Direct Write Overwrite
        print("\n--- TEST 1: Direct File Write Overwrite ---")
        direct_write_ok = False
        direct_write_err = None
        try:
            with open(SCRIPT_PATH, "wb") as f:
                f.write(witness_bytes)
            direct_write_ok = True
            print("DIRECT_WRITE: SUCCESS (No sharing violation or file lock detected)")
        except Exception as e:
            direct_write_err = str(e)
            print(f"DIRECT_WRITE: FAILED ({e})")

        curr_script_sha = sha256_file(SCRIPT_PATH)
        fixture_sha = hashlib.sha256(witness_bytes).hexdigest().lower()
        print(f"Current Script.js SHA256: {curr_script_sha}")
        print(f"Fixture SHA256           : {fixture_sha}")

        # 2. Test Atomic Replace
        print("\n--- TEST 2: Atomic Replace via os.replace ---")
        tmp_path = PROFILES_DIR / "Script.js.tmp_probe"
        atomic_replace_ok = False
        atomic_replace_err = None
        try:
            with open(tmp_path, "wb") as f:
                f.write(witness_bytes)
            os.replace(tmp_path, SCRIPT_PATH)
            atomic_replace_ok = True
            print("ATOMIC_REPLACE: SUCCESS (os.replace succeeded without error)")
        except Exception as e:
            atomic_replace_err = str(e)
            print(f"ATOMIC_REPLACE: FAILED ({e})")
        finally:
            if tmp_path.exists():
                tmp_path.unlink()

        # 3. Test Bounded Passive Observation (No GUI, No restart, No reload)
        print("\n--- TEST 3: Bounded Passive Observation (5s) ---")
        print("Waiting 5 seconds to observe if CVR auto-detects Script.js change...")
        time.sleep(5.0)

        yaml_after_mtime = YAML_PATH.stat().st_mtime_ns if YAML_PATH.exists() else 0
        yaml_after_sha = sha256_file(YAML_PATH) if YAML_PATH.exists() else ""

        marker_found = False
        if YAML_PATH.exists():
            with open(YAML_PATH, "r", encoding="utf-8", errors="ignore") as f:
                yaml_content = f.read()
            witness_marker = "CLASH_FLEET_GATE_B_WINDOWS_BENIGN_WITNESS"
            marker_found = witness_marker in yaml_content

        mtime_changed = (yaml_after_mtime != yaml_before_mtime)
        sha_changed = (yaml_after_sha != yaml_before_sha)

        print(f"clash-verge.yaml mtime changed: {mtime_changed}")
        print(f"clash-verge.yaml SHA changed  : {sha_changed}")
        print(f"Witness marker found in YAML  : {marker_found}")

        if not mtime_changed and not sha_changed and not marker_found:
            raw_replacement_result = "NO_AUTO_APPLY_OBSERVED"
            print("\nRESULT: NO_AUTO_APPLY_OBSERVED (Passive external replacement does NOT trigger CVR re-execution)")
        else:
            raw_replacement_result = "AUTO_APPLY_DETECTED"
            print(f"\nRESULT: AUTO_APPLY_DETECTED (Unexpected! mtime_changed={mtime_changed}, marker={marker_found})")

        # Classification
        if direct_write_ok and atomic_replace_ok:
            classification = "DIRECT_WRITE_OK (and ATOMIC_REPLACE_OK)"
        elif atomic_replace_ok:
            classification = "ATOMIC_REPLACE_REQUIRED"
        elif not direct_write_ok and not atomic_replace_ok:
            classification = "FILE_LOCK_BLOCKER"
        else:
            classification = "UNCERTAIN"

        print(f"\nWindows File Replacement Classification: {classification}")
        print(f"Raw Replacement Lifecycle Result       : {raw_replacement_result}")

        results = {
            "direct_write_ok": direct_write_ok,
            "direct_write_err": direct_write_err,
            "atomic_replace_ok": atomic_replace_ok,
            "atomic_replace_err": atomic_replace_err,
            "classification": classification,
            "raw_replacement_result": raw_replacement_result,
            "yaml_mtime_changed": mtime_changed,
            "marker_found": marker_found,
        }

    except Exception as exc:
        probe_exception = exc
        print(f"\nUNHANDLED EXCEPTION DURING PROBE: {exc}")

    finally:
        # FAIL-CLOSED UNCONDITIONAL RESTORATION
        print("\n--- SAFETY RESTORATION: Reverting Script.js to baseline ---")
        restore_success = False
        try:
            restore_tmp = PROFILES_DIR / "Script.js.restore_tmp"
            with open(restore_tmp, "wb") as f:
                f.write(baseline_bytes)
            os.replace(restore_tmp, SCRIPT_PATH)
            restore_success = True
        except Exception as rest_err:
            print(f"CRITICAL: Atomic restore failed ({rest_err}), attempting direct overwrite...")
            try:
                with open(SCRIPT_PATH, "wb") as f:
                    f.write(baseline_bytes)
                restore_success = True
            except Exception as direct_err:
                print(f"FATAL: Direct overwrite also failed: {direct_err}")

        # Post-restoration SHA-256 verification
        post_restore_sha = sha256_file(SCRIPT_PATH) if SCRIPT_PATH.exists() else "FILE_MISSING"
        print(f"Restored Script.js SHA256: {post_restore_sha}")
        print(f"Expected Baseline SHA256 : {EXPECTED_BASELINE_SHA256}")

        if post_restore_sha != EXPECTED_BASELINE_SHA256:
            print("FATAL ERROR: Baseline restoration failed or SHA mismatch! Exiting non-zero.")
            sys.exit(2)
        else:
            print("SAFETY RESTORATION: SUCCESS (Baseline restored and verified byte-for-byte)")

    if probe_exception is not None:
        raise probe_exception

    return results


if __name__ == "__main__":
    run_probe()
