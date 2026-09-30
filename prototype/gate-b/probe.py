#!/usr/bin/env python3
"""
Clash Fleet — Gate B macOS Deploy & Apply Lifecycle Probe
Automated test probe to verify CVR extension script reload & execution lifecycle.
"""

import argparse
import hashlib
import http.client
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

# Paths
HOME = Path.home()
CVR_APP_DIR = HOME / "Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"
SCRIPT_PATH = CVR_APP_DIR / "profiles/Script.js"
RUNTIME_CONFIG = CVR_APP_DIR / "clash-verge.yaml"
LATEST_LOG = CVR_APP_DIR / "logs/latest.log"
UNIX_SOCK_SERVICE = Path("/var/run/clash-verge-service/users/501/verge-mihomo.sock")


def get_cvr_pid():
    res = subprocess.run(["pgrep", "-x", "clash-verge"], capture_output=True, text=True)
    pids = [int(p) for p in res.stdout.strip().split() if p]
    return pids[0] if pids else None


def file_sha256(path: Path) -> str:
    if not path.exists():
        return ""
    return hashlib.sha256(path.read_bytes()).hexdigest()


class SafeScriptContext:
    """Context manager ensuring Script.js is strictly backed up and restored unconditionally."""

    def __init__(self, script_path: Path):
        self.script_path = script_path
        self.original_bytes = None
        self.original_hash = None

    def __enter__(self):
        self.original_bytes = self.script_path.read_bytes()
        self.original_hash = hashlib.sha256(self.original_bytes).hexdigest()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Unconditional rollback
        self.script_path.write_bytes(self.original_bytes)
        restored_hash = hashlib.sha256(self.script_path.read_bytes()).hexdigest()
        if restored_hash != self.original_hash:
            raise RuntimeError(f"CRITICAL: Failed to restore Script.js! Hash mismatch: {restored_hash} vs {self.original_hash}")


def probe_baseline():
    pid = get_cvr_pid()
    s_hash = file_sha256(SCRIPT_PATH)
    r_hash = file_sha256(RUNTIME_CONFIG)
    r_mtime = os.stat(RUNTIME_CONFIG).st_mtime if RUNTIME_CONFIG.exists() else 0

    return {
        "status": "PASS",
        "cvr_pid": pid,
        "script_sha256": s_hash,
        "runtime_config_sha256": r_hash,
        "runtime_config_mtime": r_mtime,
    }


def probe_raw_replace(wait_seconds: int = 10):
    with SafeScriptContext(SCRIPT_PATH) as ctx:
        marker = f"CLASH_FLEET_GATE_B_RAW_{int(time.time())}"
        orig_content = ctx.original_bytes.decode("utf-8")
        parts = orig_content.rsplit("return config;", 1)
        if len(parts) != 2:
            return {"status": "FAIL", "reason": "Cannot locate return config;"}

        modified = parts[0] + f'config["gate_b_witness"] = "{marker}";\n    return config;' + parts[1]
        mtime_before = os.stat(RUNTIME_CONFIG).st_mtime
        SCRIPT_PATH.write_text(modified, encoding="utf-8")

        time.sleep(wait_seconds)

        mtime_after = os.stat(RUNTIME_CONFIG).st_mtime
        runtime_c = RUNTIME_CONFIG.read_text(encoding="utf-8")
        has_marker = marker in runtime_c

        return {
            "status": "PASS",
            "marker": marker,
            "wait_seconds": wait_seconds,
            "mtime_changed": mtime_after != mtime_before,
            "witness_observed": has_marker,
            "verdict": "AUTO_APPLY_CONFIRMED" if has_marker else "NO_AUTO_APPLY_OBSERVED",
        }


def probe_restart_trigger():
    with SafeScriptContext(SCRIPT_PATH) as ctx:
        marker = f"CLASH_FLEET_GATE_B_RESTART_{int(time.time())}"
        orig_content = ctx.original_bytes.decode("utf-8")
        parts = orig_content.rsplit("return config;", 1)
        if len(parts) != 2:
            return {"status": "FAIL", "reason": "Cannot locate return config;"}

        modified = parts[0] + f'config["gate_b_witness"] = "{marker}";\n    return config;' + parts[1]

        pid = get_cvr_pid()
        if not pid:
            return {"status": "FAIL", "reason": "CVR is not running"}

        # 1. Graceful stop CVR
        os.kill(pid, 15)
        for _ in range(50):
            if get_cvr_pid() is None:
                break
            time.sleep(0.1)

        # 2. Write modified script
        SCRIPT_PATH.write_text(modified, encoding="utf-8")

        # 3. Launch CVR
        subprocess.run(["open", "-a", "Clash Verge"], check=True)
        new_pid = None
        for _ in range(50):
            new_pid = get_cvr_pid()
            if new_pid:
                break
            time.sleep(0.2)

        # 4. Wait for generation
        witness_found = False
        for _ in range(30):
            time.sleep(0.5)
            if RUNTIME_CONFIG.exists() and marker in RUNTIME_CONFIG.read_text(encoding="utf-8"):
                witness_found = True
                break

    # Context exit restores script; restart once more to clear witness from runtime
    cur_pid = get_cvr_pid()
    if cur_pid:
        os.kill(cur_pid, 15)
        for _ in range(50):
            if get_cvr_pid() is None:
                break
            time.sleep(0.1)
    subprocess.run(["open", "-a", "Clash Verge"], check=True)
    time.sleep(5)

    return {
        "status": "PASS",
        "marker": marker,
        "new_pid": new_pid,
        "witness_observed": witness_found,
        "verdict": "RESTART_CONFIRMED_MINIMUM_TRIGGER" if witness_found else "RESTART_FAILED",
    }


def probe_mihomo_neg_ctrl():
    if not UNIX_SOCK_SERVICE.exists():
        return {"status": "SKIPPED", "reason": "Unix socket not found"}

    with SafeScriptContext(SCRIPT_PATH) as ctx:
        marker = f"CLASH_FLEET_GATE_B_NEG_CTRL_{int(time.time())}"
        orig_content = ctx.original_bytes.decode("utf-8")
        parts = orig_content.rsplit("return config;", 1)
        modified = parts[0] + f'config["gate_b_witness"] = "{marker}";\n    return config;' + parts[1]
        SCRIPT_PATH.write_text(modified, encoding="utf-8")

        mtime_before = os.stat(RUNTIME_CONFIG).st_mtime

        # Send PUT /configs
        class UnixConn(http.client.HTTPConnection):
            def connect(self):
                self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.sock.connect(str(UNIX_SOCK_SERVICE))

        conn = UnixConn("localhost")
        allowed_path = "/Library/Application Support/clash-verge-service/users/501/runtime/config.yaml"
        body = json.dumps({"path": allowed_path})
        conn.request("PUT", "/configs?force=true", body=body, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        resp_status = resp.status
        resp.read()

        time.sleep(3)
        mtime_after = os.stat(RUNTIME_CONFIG).st_mtime
        runtime_c = RUNTIME_CONFIG.read_text(encoding="utf-8")
        has_marker = marker in runtime_c

    return {
        "status": "PASS",
        "mihomo_put_configs_status": resp_status,
        "runtime_mtime_changed": mtime_after != mtime_before,
        "witness_observed": has_marker,
        "verdict": "VERIFIED_NEGATIVE_CONTROL" if (resp_status in [200, 204] and not has_marker) else "UNEXPECTED",
    }


def main():
    parser = argparse.ArgumentParser(description="Gate B Lifecycle Probe")
    parser.add_argument("--mode", choices=["baseline", "raw-replace", "restart-trigger", "mihomo-neg-ctrl"], default="baseline")
    args = parser.parse_args()

    if args.mode == "baseline":
        res = probe_baseline()
    elif args.mode == "raw-replace":
        res = probe_raw_replace()
    elif args.mode == "restart-trigger":
        res = probe_restart_trigger()
    elif args.mode == "mihomo-neg-ctrl":
        res = probe_mihomo_neg_ctrl()
    else:
        res = {"status": "FAIL", "reason": "Unknown mode"}

    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
