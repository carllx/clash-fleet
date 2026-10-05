/**
 * #17 Phase-A 跨平台合成贯穿测试 (Cross-Platform Synthetic Tracer Suite)
 *
 * 核心验证目标：
 * 1. 跨平台不变量验证：macOS 与 Windows 观测数据形态虽异，但在相同逻辑事实下产生 100% 相同裁决；
 * 2. 证据门禁：non-Verified source digest 或 non-Verified runtime evidence 严禁输出终态，必须收敛为 Unknown + reconcile；
 * 3. 空断言门禁：立即激活意图下，空断言不能假定为已激活，必须输出 Unknown + reconcile；
 * 4. 恢复资格全要素门禁：仅凭 LKG digest 或日志异常绝不能触发 guided_recovery，必须具备完整 4 项正面事实；
 * 5. 取消与失败门禁：仅凭 base digest 不能判 Unchanged，必须有 explicit preEffectProof；
 * 6. 安全白名单 Schema 门禁：拒绝 accessToken, apiKey 等未知敏感属性，允许 authMode: token 描述符；
 * 7. 路径脱敏门禁：拒绝未脱敏的 /Users/... 与 C:\Users\... 根路径；
 * 8. Digest 格式校验：拒绝 malformed digest；
 * 9. LogicalTarget 显式绑定：拒绝缺失或隐式假装生产标识。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_LEVELS,
  createFactEvidence,
  createChangeOperation,
  createPlatformObservationBundle,
  validateObservationBundle,
} from '../src/reconcile/contracts.js';
import {
  reconcileOperation,
  evaluateSemanticAssertions,
} from '../src/reconcile/reconciler.js';
import {
  SYNTHETIC_BASE_DIGEST,
  SYNTHETIC_CANDIDATE_DIGEST,
  SYNTHETIC_DRIFT_DIGEST,
  SYNTHETIC_LAST_KNOWN_GOOD_DIGEST,
  createSyntheticMacosObservation,
  createSyntheticWindowsObservation,
} from './fixtures/synthetic-observations.js';

test('Clash Fleet #17 Phase-A Cross-Platform Synthetic Tracer Suite', async (t) => {
  // 完全中立的合成策略与断言规范 (Policy-Neutral Fixtures)
  const neutralAssertions = [
    { assertion: 'rule_present', identity: 'DOMAIN-SUFFIX,fixture.invalid', expectedTarget: 'POLICY_A' },
    { assertion: 'group_exists', groupIdentity: 'GROUP_A' },
  ];

  const syntheticLogicalTarget = {
    appScope: 'io.clash.fleet.synthetic',
    profileId: 'synthetic-profile-01',
    artifactKind: 'synthetic_script',
  };

  const createTestOp = (overrides = {}) =>
    createChangeOperation({
      operationId: overrides.operationId || 'op_test_default',
      candidateDigest: overrides.candidateDigest || SYNTHETIC_CANDIDATE_DIGEST,
      baseDigest: overrides.baseDigest || SYNTHETIC_BASE_DIGEST,
      logicalTarget: overrides.logicalTarget !== undefined ? overrides.logicalTarget : syntheticLogicalTarget,
      attemptResult: overrides.attemptResult || 'submitted',
      changeIntent: overrides.changeIntent,
      lastKnownGoodDigest: overrides.lastKnownGoodDigest,
      closureMetadata: overrides.closureMetadata,
    });

  const verifiedMatchingRuntime = {
    controllerConnected: true,
    rules: ['DOMAIN-SUFFIX,fixture.invalid,POLICY_A', 'MATCH,GROUP_A'],
    proxies: { GROUP_A: { name: 'GROUP_A', type: 'select' }, POLICY_A: { name: 'POLICY_A', type: 'select' } },
    configs: { mode: 'rule' },
    cvrExceptionLogged: false,
    evidence: createFactEvidence('Verified', 'synthetic_controller_snapshot'),
  };

  const verifiedNonMatchingRuntime = {
    controllerConnected: true,
    rules: ['MATCH,DIRECT'],
    proxies: { DIRECT: { name: 'DIRECT', type: 'direct' } },
    configs: { mode: 'rule' },
    cvrExceptionLogged: true,
    evidence: createFactEvidence('Verified', 'synthetic_controller_snapshot'),
  };

  await t.test('1. macOS fixture yields Applied and NextAction none when assertions pass with Verified evidence', () => {
    const op = createTestOp();
    const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
    const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: verifiedMatchingRuntime });

    assert.equal(result.activationOutcome, 'Applied');
    assert.equal(result.nextAction, 'none');
    assert.equal(result.evidenceSummary.semanticAssertionsPassed, true);
    assert.equal(result.evidenceSummary.sourceDigestMatchedCandidate, true);
    assert.equal(result.recoveryPlan, null);
  });

  await t.test('2. Windows fixture yields Applied and NextAction none when assertions pass with Verified evidence', () => {
    const op = createTestOp();
    const observation = createSyntheticWindowsObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
    const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: verifiedMatchingRuntime });

    assert.equal(result.activationOutcome, 'Applied');
    assert.equal(result.nextAction, 'none');
    assert.equal(result.evidenceSummary.semanticAssertionsPassed, true);
    assert.equal(result.evidenceSummary.sourceDigestMatchedCandidate, true);
    assert.equal(result.recoveryPlan, null);
  });

  await t.test('3. Cross-Platform Invariant: identical logical facts produce strictly identical Activation & NextAction', () => {
    const op = createTestOp();
    const macosObs = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
    const win32Obs = createSyntheticWindowsObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });

    const macosResult = reconcileOperation({ operation: op, observation: macosObs, assertions: neutralAssertions, runtimeEvidence: verifiedMatchingRuntime });
    const win32Result = reconcileOperation({ operation: op, observation: win32Obs, assertions: neutralAssertions, runtimeEvidence: verifiedMatchingRuntime });

    assert.equal(macosResult.activationOutcome, win32Result.activationOutcome);
    assert.equal(macosResult.nextAction, win32Result.nextAction);
    assert.equal(macosResult.evidenceSummary.semanticAssertionsPassed, win32Result.evidenceSummary.semanticAssertionsPassed);
    assert.equal(macosResult.evidenceSummary.sourceDigestMatchedCandidate, win32Result.evidenceSummary.sourceDigestMatchedCandidate);
  });

  await t.test('4. Evidence Level Gate on Source Digest: non-Verified digest yields Unknown and NextAction reconcile', () => {
    const op = createTestOp();
    const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST, targetEvidenceLevel: 'Reported' });
    const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: verifiedMatchingRuntime });

    assert.equal(result.activationOutcome, 'Unknown');
    assert.equal(result.nextAction, 'reconcile');
    assert.equal(result.evidenceSummary.insufficientEvidence, true);
  });

  await t.test('5. Evidence Level Gate on Runtime Snapshot: non-Verified runtime yields Unknown and NextAction reconcile', () => {
    const op = createTestOp();
    const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
    const reportedRuntime = { ...verifiedMatchingRuntime, evidence: createFactEvidence('Reported', 'untrusted_cache') };

    const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: reportedRuntime });

    assert.equal(result.activationOutcome, 'Unknown');
    assert.equal(result.nextAction, 'reconcile');
    assert.equal(result.evidenceSummary.insufficientEvidence, true);
  });

  await t.test('6. Empty Semantic Assertions Gate: cannot prove Applied when immediate activation required', () => {
    const op = createTestOp({ changeIntent: { name: 'immediate_change', immediateActivationRequired: true } });
    const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
    const result = reconcileOperation({ operation: op, observation, assertions: [], runtimeEvidence: verifiedMatchingRuntime });

    assert.equal(result.activationOutcome, 'Unknown');
    assert.equal(result.nextAction, 'reconcile');
    assert.equal(result.evidenceSummary.insufficientEvidence, true);
  });

  await t.test('7. SavedOnly scenarios & Recovery Eligibility Gate', async (t2) => {
    await t2.test('7.1 Bare LKG digest alone DOES NOT authorize guided recovery -> yields manual_required', () => {
      const op = createTestOp({ lastKnownGoodDigest: SYNTHETIC_LAST_KNOWN_GOOD_DIGEST });
      const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
      const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: verifiedNonMatchingRuntime, recoveryContext: null });

      assert.equal(result.activationOutcome, 'SavedOnly');
      assert.equal(result.nextAction, 'manual_required');
      assert.equal(result.evidenceSummary.recoveryEligible, false);
      assert.equal(result.recoveryPlan, null);
    });

    await t2.test('7.2 Fully proven recovery eligibility facts authorize guided recovery', () => {
      const op = createTestOp({ lastKnownGoodDigest: SYNTHETIC_LAST_KNOWN_GOOD_DIGEST });
      const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
      const fullRecoveryContext = { failureAttributableToOperation: true, lastKnownGoodAcceptedSnapshot: true, snapshotDigestConsistent: true, noExternalConflict: true };
      const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: verifiedNonMatchingRuntime, recoveryContext: fullRecoveryContext });

      assert.equal(result.activationOutcome, 'SavedOnly');
      assert.equal(result.nextAction, 'guided_recovery');
      assert.equal(result.evidenceSummary.recoveryEligible, true);
      assert.ok(result.recoveryPlan);
      assert.equal(result.recoveryPlan.restoreToDigest, SYNTHETIC_LAST_KNOWN_GOOD_DIGEST);
    });

    await t2.test('7.3 Deferred activation explicitly allowed: converges to none without recovery', () => {
      const op = createTestOp({ changeIntent: { name: 'deferred_update', immediateActivationRequired: false } });
      const observation = createSyntheticWindowsObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
      const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: verifiedNonMatchingRuntime });

      assert.equal(result.activationOutcome, 'SavedOnly');
      assert.equal(result.nextAction, 'none');
    });
  });

  await t.test('8. Conflict scenario: external digest drift blocks automation and requires manual intervention', () => {
    const op = createTestOp({ attemptResult: 'awaiting_user' });
    const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_DRIFT_DIGEST });
    const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: verifiedMatchingRuntime });

    assert.equal(result.activationOutcome, 'Conflict');
    assert.equal(result.nextAction, 'manual_required');
    assert.equal(result.evidenceSummary.driftDetected, true);
    assert.equal(result.recoveryPlan, null);
  });

  await t.test('9. Cancelled & Failed preEffectProof Gates', async (t2) => {
    await t2.test('9.1 Cancelled + base WITHOUT preEffectProof yields Unknown and NextAction reconcile', () => {
      const op = createTestOp({ attemptResult: 'cancelled', closureMetadata: null });
      const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_BASE_DIGEST });
      const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: null });

      assert.equal(result.activationOutcome, 'Unknown');
      assert.equal(result.nextAction, 'reconcile');
      assert.equal(result.evidenceSummary.insufficientEvidence, true);
    });

    await t2.test('9.2 Cancelled + Verified base WITH explicit preEffectProof yields Unchanged and NextAction none', () => {
      const op = createTestOp({ attemptResult: 'cancelled', closureMetadata: { closedByUser: true, preEffectProof: true } });
      const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_BASE_DIGEST });
      const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: null });

      assert.equal(result.activationOutcome, 'Unchanged');
      assert.equal(result.nextAction, 'none');
      assert.equal(result.evidenceSummary.sourceDigestMatchedBase, true);
    });

    await t2.test('9.3 Failed + Verified base WITH explicit preEffectProof yields Unchanged and NextAction none', () => {
      const op = createTestOp({ attemptResult: 'failed', closureMetadata: { preEffectProof: true } });
      const observation = createSyntheticWindowsObservation({ targetDigest: SYNTHETIC_BASE_DIGEST });
      const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: null });

      assert.equal(result.activationOutcome, 'Unchanged');
      assert.equal(result.nextAction, 'none');
    });
  });

  await t.test('10. no_response scenario does not blindly resend and reconciles live state', async (t2) => {
    await t2.test('10.1 no_response recovers to Applied when positive live evidence verifies candidate active', () => {
      const op = createTestOp({ attemptResult: 'no_response' });
      const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_CANDIDATE_DIGEST });
      const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: verifiedMatchingRuntime });

      assert.equal(result.activationOutcome, 'Applied');
      assert.equal(result.nextAction, 'none');
    });

    await t2.test('10.2 no_response remains Unknown and directs reconcile when live state unresolved', () => {
      const op = createTestOp({ attemptResult: 'no_response' });
      const observation = createSyntheticWindowsObservation({ targetDigest: null, exists: false, targetEvidenceLevel: 'Unknown' });
      const result = reconcileOperation({ operation: op, observation, assertions: neutralAssertions, runtimeEvidence: null });

      assert.equal(result.activationOutcome, 'Unknown');
      assert.equal(result.nextAction, 'reconcile');
      assert.equal(result.evidenceSummary.insufficientEvidence, true);
    });
  });

  await t.test('11. Security Schema & Fail-Closed Gate on Observation Bundle', async (t2) => {
    const baseValid = {
      platform: 'darwin',
      targetDigest: { value: SYNTHETIC_CANDIDATE_DIGEST, exists: true, evidence: createFactEvidence('Verified', 'test') },
      topologyMode: { value: 'SERVICE', evidence: createFactEvidence('Verified', 'test') },
      controllerEndpoint: null,
      sanitizedPaths: { dataDir: '~/Library/Data' },
    };

    await t2.test('11.1 Rejects unexpected sensitive keys: accessToken, apiKey, authorization, credentialRef', () => {
      assert.throws(() => validateObservationBundle({ ...baseValid, accessToken: 'leak_secret' }), /Security violation: Unexpected or forbidden field "accessToken"/);
      assert.throws(() => validateObservationBundle({ ...baseValid, apiKey: 'leak_key' }), /Security violation: Unexpected or forbidden field "apiKey"/);
      assert.throws(() => validateObservationBundle({ ...baseValid, authorization: 'Bearer 123' }), /Security violation: Unexpected or forbidden field "authorization"/);
      assert.throws(
        () =>
          validateObservationBundle({
            ...baseValid,
            controllerEndpoint: { endpointType: 'named_pipe', sanitizedAddress: 'pipe', authRequired: true, authMode: 'token', credentialRef: 'ENV_TOKEN', evidence: createFactEvidence('Verified', 'test') },
          }),
        /Security violation: Unexpected or forbidden field "credentialRef"/
      );
    });

    await t2.test('11.2 authMode: "token" descriptor is accepted without secret material', () => {
      const bundle = createPlatformObservationBundle({
        platform: 'win32',
        targetDigest: { value: SYNTHETIC_CANDIDATE_DIGEST, exists: true, evidence: createFactEvidence('Verified', 'test') },
        topologyMode: { value: 'SIDECAR', evidence: createFactEvidence('Verified', 'test') },
        controllerEndpoint: { endpointType: 'http', sanitizedAddress: '127.0.0.1:9090', authRequired: true, authMode: 'token', evidence: createFactEvidence('Verified', 'test') },
        sanitizedPaths: { dataDir: '%APPDATA%\\Clash' },
      });
      assert.equal(bundle.controllerEndpoint.authMode, 'token');
    });

    await t2.test('11.3 Fails closed on raw /Users/... or C:\\Users\\... user root paths', () => {
      assert.throws(() => validateObservationBundle({ ...baseValid, sanitizedPaths: { dataDir: ['/', 'Users', '/alice/Library'].join('') } }), /Security violation: Unsanitized user root path/);
      assert.throws(() => validateObservationBundle({ ...baseValid, platform: 'win32', sanitizedPaths: { dataDir: ['C:', '\\Users', '\\alice\\AppData'].join('') } }), /Security violation: Unsanitized user root path/);
    });

    await t2.test('11.4 Fails closed on malformed digests', () => {
      assert.throws(() => createTestOp({ candidateDigest: 'short-digest' }), /Malformed SHA-256 hex/);
      assert.throws(() => createTestOp({ candidateDigest: 'z'.repeat(64) }), /Malformed SHA-256 hex/);
    });

    await t2.test('11.5 Fails closed when logicalTarget is missing or non-object', () => {
      assert.throws(() => createChangeOperation({ operationId: 'op_no_target', candidateDigest: SYNTHETIC_CANDIDATE_DIGEST, baseDigest: SYNTHETIC_BASE_DIGEST }), /ChangeOperation requires explicit logicalTarget object/);
    });
  });

  await t.test('12. Evidence Level Discipline: enforces Verified | Reported | Inferred | Unknown and rejects None', () => {
    assert.deepEqual(EVIDENCE_LEVELS, ['Verified', 'Reported', 'Inferred', 'Unknown']);
    assert.throws(() => createFactEvidence('None', 'bad_source'), /Invalid evidence level: "None"/);
    assert.throws(() => createFactEvidence('InvalidLevel', 'bad_source'), /Invalid evidence level/);
    const validEvidence = createFactEvidence('Verified', 'ps_scan', 'Process observed');
    assert.equal(validEvidence.level, 'Verified');
  });

  await t.test('13. Phase-A Boundary Bug Regressions', async (t2) => {
    const baseBundle = {
      platform: 'darwin',
      targetDigest: { value: SYNTHETIC_CANDIDATE_DIGEST, exists: true, evidence: createFactEvidence('Verified', 'test') },
      topologyMode: { value: 'SERVICE', evidence: createFactEvidence('Verified', 'test') },
      controllerEndpoint: null,
      sanitizedPaths: { dataDir: '~/Library/Data' },
    };

    await t2.test('13.1 Bug 1: Rejects contradictory targetDigest (exists=false with value or value=present with exists=false)', () => {
      assert.throws(
        () =>
          validateObservationBundle({
            ...baseBundle,
            targetDigest: { value: SYNTHETIC_CANDIDATE_DIGEST, exists: false, evidence: createFactEvidence('Verified', 'test') },
          }),
        /Contradictory observation: targetDigest exists is false but value is not null/
      );
    });

    await t2.test('13.2 Bug 2: evaluateSemanticAssertions enforces standalone Verified runtime evidence gate', () => {
      const assertions = [
        { assertion: 'rule_present', identity: 'DOMAIN-SUFFIX,fixture.invalid', expectedTarget: 'POLICY_A' },
      ];
      const validRules = ['DOMAIN-SUFFIX,fixture.invalid,POLICY_A'];

      // Non-Verified runtime evidence (Reported) fails evaluation
      const reportedRuntime = {
        controllerConnected: true,
        rules: validRules,
        proxies: {},
        evidence: createFactEvidence('Reported', 'untrusted_snapshot'),
      };
      const resReported = evaluateSemanticAssertions(assertions, reportedRuntime);
      assert.equal(resReported.evaluated, false);
      assert.equal(resReported.passed, false);
      assert.match(resReported.details[0].reason, /Runtime evidence is not Verified/);

      // Missing evidence fails evaluation
      const missingEvidenceRuntime = {
        controllerConnected: true,
        rules: validRules,
        proxies: {},
      };
      const resMissing = evaluateSemanticAssertions(assertions, missingEvidenceRuntime);
      assert.equal(resMissing.evaluated, false);
      assert.equal(resMissing.passed, false);

      // Controller unreachable fails evaluation
      const disconnectedRuntime = {
        controllerConnected: false,
        rules: validRules,
        proxies: {},
        evidence: createFactEvidence('Verified', 'test'),
      };
      const resDisconnected = evaluateSemanticAssertions(assertions, disconnectedRuntime);
      assert.equal(resDisconnected.evaluated, false);
      assert.equal(resDisconnected.passed, false);

      // Verified runtime passes evaluation
      const verifiedRuntime = {
        controllerConnected: true,
        rules: validRules,
        proxies: {},
        evidence: createFactEvidence('Verified', 'test'),
      };
      const resVerified = evaluateSemanticAssertions(assertions, verifiedRuntime);
      assert.equal(resVerified.evaluated, true);
      assert.equal(resVerified.passed, true);
      assert.equal(resVerified.verifiedCount, 1);
    });

    await t2.test('13.3 Bug 3: submitted and no_response with Verified base digest yield Unknown + reconcile without preEffectProof', () => {
      const observation = createSyntheticMacosObservation({ targetDigest: SYNTHETIC_BASE_DIGEST });

      // submitted with base digest and no preEffectProof
      const submittedOp = createTestOp({ attemptResult: 'submitted', closureMetadata: null });
      const resSubmitted = reconcileOperation({ operation: submittedOp, observation, assertions: neutralAssertions });
      assert.equal(resSubmitted.activationOutcome, 'Unknown');
      assert.equal(resSubmitted.nextAction, 'reconcile');
      assert.equal(resSubmitted.evidenceSummary.insufficientEvidence, true);

      // no_response with base digest and no preEffectProof
      const noResponseOp = createTestOp({ attemptResult: 'no_response', closureMetadata: null });
      const resNoResponse = reconcileOperation({ operation: noResponseOp, observation, assertions: neutralAssertions });
      assert.equal(resNoResponse.activationOutcome, 'Unknown');
      assert.equal(resNoResponse.nextAction, 'reconcile');
      assert.equal(resNoResponse.evidenceSummary.insufficientEvidence, true);

      // Explicit preEffectProof allows Unchanged + none
      const proofOp = createTestOp({ attemptResult: 'submitted', closureMetadata: { preEffectProof: true } });
      const resProof = reconcileOperation({ operation: proofOp, observation, assertions: neutralAssertions });
      assert.equal(resProof.activationOutcome, 'Unchanged');
      assert.equal(resProof.nextAction, 'none');
    });

    await t2.test('13.4 Bug 4: Exact rule parsing prevents substring near-match false-positives', () => {
      const assertions = [
        { assertion: 'rule_present', identity: 'DOMAIN-SUFFIX,fixture.invalid', expectedTarget: 'POLICY_A' },
      ];

      // Runtime only has evil near-match substring
      const nearMatchRuntime = {
        controllerConnected: true,
        rules: ['DOMAIN-SUFFIX,fixture.invalid.evil,POLICY_A'],
        proxies: {},
        evidence: createFactEvidence('Verified', 'test'),
      };
      const resNear = evaluateSemanticAssertions(assertions, nearMatchRuntime);
      assert.equal(resNear.evaluated, true);
      assert.equal(resNear.passed, false);
      assert.equal(resNear.verifiedCount, 0);

      // Runtime has exact rule
      const exactMatchRuntime = {
        controllerConnected: true,
        rules: [
          'DOMAIN-SUFFIX,fixture.invalid.evil,POLICY_A',
          'DOMAIN-SUFFIX,fixture.invalid,POLICY_A',
        ],
        proxies: {},
        evidence: createFactEvidence('Verified', 'test'),
      };
      const resExact = evaluateSemanticAssertions(assertions, exactMatchRuntime);
      assert.equal(resExact.evaluated, true);
      assert.equal(resExact.passed, true);
      assert.equal(resExact.verifiedCount, 1);
    });

    await t2.test('13.5 Bug 5: controllerEndpoint.sanitizedAddress fails closed on raw user root paths', () => {
      // Raw /Users/... path
      assert.throws(
        () =>
          validateObservationBundle({
            ...baseBundle,
            controllerEndpoint: {
              endpointType: 'unix_socket',
              sanitizedAddress: ['/', 'Users', '/victim/Library/mihomo.sock'].join(''),
              authRequired: false,
              authMode: 'none',
              evidence: createFactEvidence('Verified', 'test'),
            },
          }),
        /Security violation: Unsanitized user root path detected in "controllerEndpoint\.sanitizedAddress"/
      );

      // Raw C:\Users\... path
      assert.throws(
        () =>
          validateObservationBundle({
            ...baseBundle,
            platform: 'win32',
            controllerEndpoint: {
              endpointType: 'named_pipe',
              sanitizedAddress: ['C:', '\\Users', '\\victim\\pipe'].join(''),
              authRequired: false,
              authMode: 'none',
              evidence: createFactEvidence('Verified', 'test'),
            },
          }),
        /Security violation: Unsanitized user root path detected in "controllerEndpoint\.sanitizedAddress"/
      );

      // Sanitized paths succeed
      const validMac = validateObservationBundle({
        ...baseBundle,
        controllerEndpoint: {
          endpointType: 'unix_socket',
          sanitizedAddress: '~/Library/Application Support/mihomo.sock',
          authRequired: false,
          authMode: 'none',
          evidence: createFactEvidence('Verified', 'test'),
        },
      });
      assert.equal(validMac.controllerEndpoint.sanitizedAddress, '~/Library/Application Support/mihomo.sock');
    });
  });
});
