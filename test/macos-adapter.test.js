import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  sanitizePath,
  resolveMacosPaths,
  parseProcessLine,
  detectMacosTopology,
} from '../src/deploy/platforms/macos-discovery.js';
import {
  executeMacosLifecycleReload,
} from '../src/deploy/platforms/macos-trigger.js';
import {
  MacOSPlatformAdapter,
} from '../src/deploy/platforms/macos-adapter.js';

test('macOS Platform Adapter Suite (Discovery, Topology, Lifecycle Trigger & Step 7)', async (t) => {
  await t.test('1. Path resolution and privacy sanitization', () => {
    const fakeHome = '/Users/testuser';
    const rawPath = '/Users/testuser/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev';
    const sanitized = sanitizePath(rawPath, fakeHome);
    assert.equal(sanitized, '~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev');

    // 不包含 home 的路径保持不变
    assert.equal(sanitizePath('/opt/clash', fakeHome), '/opt/clash');
    assert.equal(sanitizePath('', fakeHome), '');

    // 默认路径与自定义路径解析
    const fakeFs = { existsSync: (p) => p.includes('exists') };
    const defaultPaths = resolveMacosPaths({
      homeDir: fakeHome,
      fsModule: fakeFs,
    });
    assert.equal(defaultPaths.sanitizedDataDir, '~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev');
    assert.equal(defaultPaths.targetScript, path.join(fakeHome, 'Library', 'Application Support', 'io.github.clash-verge-rev.clash-verge-rev', 'profiles', 'Script.js'));
    assert.equal(defaultPaths.exists, false);

    const customPaths = resolveMacosPaths({
      customDataDir: '/Users/testuser/custom/exists',
      homeDir: fakeHome,
      fsModule: fakeFs,
    });
    assert.equal(customPaths.sanitizedDataDir, '~/custom/exists');
    assert.equal(customPaths.exists, true);
  });

  await t.test('2. Process parsing and detection', () => {
    const line = ' 12345    100 testuser  /Applications/Clash Verge.app/Contents/MacOS/clash-verge';
    const parsed = parseProcessLine(line);
    assert.deepEqual(parsed, {
      pid: 12345,
      ppid: 100,
      user: 'testuser',
      command: '/Applications/Clash Verge.app/Contents/MacOS/clash-verge',
    });

    assert.equal(parseProcessLine(''), null);
    assert.equal(parseProcessLine('invalid line without pid'), null);
  });

  await t.test('3. Dynamic Topology Detection: Service mode', () => {
    const serviceProcs = [
      {
        pid: 1001,
        ppid: 1,
        user: 'testuser',
        command: '/Applications/Clash Verge.app/Contents/MacOS/clash-verge',
      },
      {
        pid: 1002,
        ppid: 1,
        user: 'root',
        command: '/Library/PrivilegedHelperTools/io.github.clash-verge-rev.clash-verge-rev.service.bundle/Contents/MacOS/clash-verge-service',
      },
      {
        pid: 1003,
        ppid: 1,
        user: 'root',
        command: '/Library/Application Support/clash-verge-service/cores/verge-mihomo -d runtime -ext-ctl-unix /var/run/clash-verge-service/users/501/verge-mihomo.sock',
      },
    ];

    const result = detectMacosTopology(serviceProcs);
    assert.equal(result.status, 'SERVICE');
    assert.equal(result.passed, true);
    assert.equal(result.evidenceLevel, 'Verified');
    assert.equal(result.cvrProcess.pid, 1001);
    assert.equal(result.mihomoProcess.pid, 1003);
    assert.equal(result.serviceProcess.pid, 1002);
  });

  await t.test('4. Dynamic Topology Detection: Sidecar mode', () => {
    const sidecarProcs = [
      {
        pid: 2001,
        ppid: 1,
        user: 'testuser',
        command: '/Applications/Clash Verge.app/Contents/MacOS/clash-verge',
      },
      {
        pid: 2002,
        ppid: 2001, // ppid 指向 CVR GUI 主进程
        user: 'testuser',
        command: '/Applications/Clash Verge.app/Contents/Resources/verge-mihomo -d /Users/testuser/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev',
      },
    ];

    const result = detectMacosTopology(sidecarProcs);
    assert.equal(result.status, 'SIDECAR');
    assert.equal(result.passed, true);
    assert.equal(result.evidenceLevel, 'Verified');
    assert.equal(result.cvrProcess.pid, 2001);
    assert.equal(result.mihomoProcess.pid, 2002);
    assert.equal(result.serviceProcess, null);
  });

  await t.test('5. Fail-Closed on No Topology and Ambiguous Topology', () => {
    // A. 没有任何进程
    assert.equal(detectMacosTopology([]).status, 'NO_TOPOLOGY');
    assert.equal(detectMacosTopology([]).passed, false);

    // B. 有 Mihomo 和 Service 但无 CVR 主进程
    const noCvr = [
      { pid: 3001, ppid: 1, user: 'root', command: 'clash-verge-service' },
      { pid: 3002, ppid: 1, user: 'root', command: 'verge-mihomo' },
    ];
    assert.equal(detectMacosTopology(noCvr).status, 'NO_TOPOLOGY');
    assert.equal(detectMacosTopology(noCvr).passed, false);

    // C. 存在多个冲突的 CVR 实例
    const multiCvr = [
      { pid: 4001, ppid: 1, user: 'testuser', command: 'clash-verge' },
      { pid: 4002, ppid: 1, user: 'testuser', command: 'clash-verge' },
      { pid: 4003, ppid: 4001, user: 'testuser', command: 'verge-mihomo' },
    ];
    const ambResult = detectMacosTopology(multiCvr);
    assert.equal(ambResult.status, 'AMBIGUOUS');
    assert.equal(ambResult.passed, false);

    // D. CVR 存在但无内核
    const noKernel = [
      { pid: 5001, ppid: 1, user: 'testuser', command: 'clash-verge' },
    ];
    assert.equal(detectMacosTopology(noKernel).status, 'NO_TOPOLOGY');
    assert.equal(detectMacosTopology(noKernel).passed, false);
  });

  await t.test('6. Controlled Lifecycle Trigger: successful transition', async () => {
    let killedPid = null;
    let killedSignal = null;
    let spawned = false;
    let pollCount = 0;

    // 状态流转模拟:
    // 第一次扫描 (旧进程存活)
    // 信号发送后第二次扫描 (旧进程已退出)
    // 启动后第三次扫描 (新进程出现)
    const procStates = [
      [{ pid: 6001, ppid: 1, user: 'u', command: 'clash-verge' }],
      [],
      [{ pid: 6002, ppid: 1, user: 'u', command: 'clash-verge' }],
    ];

    const evidence = await executeMacosLifecycleReload({
      oldPid: 6001,
      terminationTimeoutMs: 1000,
      readinessTimeoutMs: 1000,
      pollIntervalMs: 10,
      killFn: (pid, signal) => {
        killedPid = pid;
        killedSignal = signal;
      },
      spawnFn: async () => {
        spawned = true;
      },
      scanFn: async () => {
        const state = procStates[pollCount] || procStates[procStates.length - 1];
        pollCount++;
        return state;
      },
      sleepFn: async () => {},
    });

    assert.equal(killedPid, 6001);
    assert.equal(killedSignal, 'SIGTERM');
    assert.equal(spawned, true);
    assert.equal(evidence.success, true);
    assert.equal(evidence.oldPid, 6001);
    assert.equal(evidence.newPid, 6002);
    assert.equal(evidence.zeroDowntimeClaimed, false);
    assert.equal(evidence.continuityReport, 'CONTROLLED_SECONDS_LEVEL_TRANSITION');
  });

  await t.test('7. Controlled Lifecycle Trigger: termination timeout fail-closed', async () => {
    // 模拟旧进程死锁不退出
    await assert.rejects(
      () =>
        executeMacosLifecycleReload({
          oldPid: 7001,
          terminationTimeoutMs: 50,
          readinessTimeoutMs: 100,
          pollIntervalMs: 10,
          killFn: () => {},
          spawnFn: async () => {},
          scanFn: async () => [{ pid: 7001, ppid: 1, user: 'u', command: 'clash-verge' }],
          sleepFn: async (ms) => new Promise((r) => setTimeout(r, ms)),
        }),
      /did not terminate within bounded timeout/
    );
  });

  await t.test('8. Controlled Lifecycle Trigger: readiness timeout fail-closed', async () => {
    // 模拟应用拉起后进程崩溃未出现
    let exited = false;
    await assert.rejects(
      () =>
        executeMacosLifecycleReload({
          oldPid: 8001,
          terminationTimeoutMs: 100,
          readinessTimeoutMs: 50,
          pollIntervalMs: 10,
          killFn: () => {
            exited = true;
          },
          spawnFn: async () => {},
          scanFn: async () => (exited ? [] : [{ pid: 8001, ppid: 1, user: 'u', command: 'clash-verge' }]),
          sleepFn: async (ms) => new Promise((r) => setTimeout(r, ms)),
        }),
      /did not become ready within bounded timeout/
    );
  });

  await t.test('9. MacOSPlatformAdapter: executeStep7 end-to-end integration', async () => {
    let reloadTriggered = false;

    const fakeProcesses = [
      { pid: 9001, ppid: 1, user: 'u', command: 'clash-verge' },
      { pid: 9002, ppid: 1, user: 'root', command: 'clash-verge-service' },
      { pid: 9003, ppid: 1, user: 'root', command: '/cores/verge-mihomo -d clash-verge-service' },
    ];

    let pollCount = 0;
    const adapter = new MacOSPlatformAdapter({
      execFn: async () => {
        return fakeProcesses.map((p) => `${p.pid} ${p.ppid} ${p.user} ${p.command}`).join('\n');
      },
      killFn: () => {},
      spawnFn: async () => {
        reloadTriggered = true;
      },
      sleepFn: async () => {},
    });

    // 覆盖 triggerLifecycleReload 中的底层观测
    adapter.triggerLifecycleReload = async () => {
      reloadTriggered = true;
      return {
        success: true,
        oldPid: 9001,
        newPid: 9005,
        elapsedMs: 120,
        elapsedSeconds: '0.12',
        continuityReport: 'CONTROLLED_SECONDS_LEVEL_TRANSITION',
        zeroDowntimeClaimed: false,
        evidenceLevel: 'Verified',
        detail: 'Transitioned from 9001 to 9005',
      };
    };

    const prevDeployResult = {
      status: 'STAGED_NOT_APPLIED',
      target: '/path/to/Script.js',
      backup: '/path/to/Script.js.bak',
      candidateSha256: 'abc123',
    };

    const finalResult = await adapter.executeStep7(prevDeployResult);
    assert.equal(reloadTriggered, true);
    assert.equal(finalResult.status, 'RELOAD_TRIGGERED');
    assert.equal(finalResult.lifecycleBoundary, 'LIFECYCLE_TRIGGERED_NOT_VERIFIED');
    assert.equal(finalResult.platform, 'darwin');
    assert.equal(finalResult.topology, 'SERVICE');
    assert.equal(finalResult.lifecycleEvidence.newPid, 9005);

    // 非法状态输入必须直接被拒绝 (Fail-Closed)
    await assert.rejects(
      () => adapter.executeStep7({ status: 'INVALID_STATUS' }),
      /Invalid deployment result state for Step 7/
    );

    // 拓扑不满足要求时拒绝执行 Step 7
    const brokenAdapter = new MacOSPlatformAdapter({
      execFn: async () => '',
    });
    await assert.rejects(
      () => brokenAdapter.executeStep7(prevDeployResult),
      /Platform adapter probe failed before Step 7/
    );
  });

  await t.test('10. Lifecycle reload failure handling: kill error and spawn error', async () => {
    // killFn 抛出异常
    await assert.rejects(
      () =>
        executeMacosLifecycleReload({
          oldPid: 9999,
          killFn: () => {
            throw new Error('EPERM operation not permitted');
          },
          spawnFn: async () => {},
          scanFn: async () => [],
        }),
      /Failed to send SIGTERM to old CVR process/
    );

    // spawnFn 抛出异常
    await assert.rejects(
      () =>
        executeMacosLifecycleReload({
          oldPid: 9998,
          terminationTimeoutMs: 100,
          readinessTimeoutMs: 100,
          killFn: () => {},
          spawnFn: async () => {
            throw new Error('Spawn binary missing');
          },
          scanFn: async () => [], // 旧进程立即退出
        }),
      /Failed to trigger application launch/
    );
  });

  await t.test('11. scanMacosProcesses filters unrelated processes and ignores grep/ps', async () => {
    const rawPsOutput = [
      '  101     1 root /sbin/launchd',
      ' 18041 18000 testuser /Applications/Clash Verge.app/Contents/MacOS/clash-verge',
      ' 18206     1 root /Library/PrivilegedHelperTools/io.github.clash-verge-rev.clash-verge-rev.service.bundle/Contents/MacOS/clash-verge-service',
      ' 18212 18206 root /Library/Application Support/clash-verge-service/cores/verge-mihomo -d runtime',
      ' 19999 18000 testuser grep clash-verge',
      ' 20000 18000 testuser ps -ax -o pid,ppid,user,command',
      ' 30000 18000 testuser /usr/bin/python3 script.py',
    ].join('\n');

    const procs = await import('../src/deploy/platforms/macos-discovery.js').then((m) =>
      m.scanMacosProcesses(async () => rawPsOutput)
    );

    assert.equal(procs.length, 3);
    assert.deepEqual(procs.map((p) => p.pid), [18041, 18206, 18212]);
  });
});
