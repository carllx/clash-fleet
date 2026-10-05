/**
 * 纯逻辑状态对账与语义激活判定核心 (Pure Reconciliation Core)
 *
 * 遵循 Canonical 规范：
 * - docs/spec/minimal-safe-apply-recovery-contract.md (#16)
 * - docs/spec/platform-contract-reconciliation.md (#17 Phase-A)
 *
 * 核心安全与证据门禁铁律 (Fail-Closed)：
 * 1. 任何终态裁决 (Applied, SavedOnly, Conflict, Unchanged) 均必须有 Verified source digest 证据；
 *    若 source digest 为 non-Verified (Reported/Inferred/Unknown)，直接收敛为 Unknown + reconcile；
 * 2. Applied 终态必须同时具备 Verified runtime evidence 快照且语义断言全部满足；
 *    若 runtime evidence 为 non-Verified，严禁裁决 Applied，必须收敛为 Unknown + reconcile；
 * 3. 立即激活意图下，空语义断言 (assertions = []) 视为物证缺失，禁止假定 PASS，必须收敛为 Unknown + reconcile；
 * 4. 恢复资格 (Recovery Eligibility) 必须同时具备 4 项正面事实证据 (归因于本次、指向历史 Accepted 快照、快照哈希一致、无外部冲突)；仅凭 lastKnownGoodDigest 或日志异常绝不能触发 guided_recovery；
 * 5. 取消或失败动作 (cancelled / failed) 即使物理摘要为 base，也必须具备显式 preEffectProof 证实发生在任何副作用动作之前，否则只能判为 Unknown + reconcile；
 * 6. 纯逻辑函数，严禁任何平台分支 (process.platform) 判断。
 */

import {
  validateObservationBundle,
  validateSemanticAssertion,
  assertSha256Hex,
} from './contracts.js';

/**
 * 评估语义断言在运行态证据中的满足情况
 *
 * @param {Array<object>} assertions 声明式语义断言列表
 * @param {object | null} runtimeEvidence 运行态证据快照
 * @returns {{
 *   evaluated: boolean,
 *   passed: boolean,
 *   total: number,
 *   verifiedCount: number,
 *   details: Array<{ assertion: string, identity: string, passed: boolean, reason?: string }>
 * }}
 */
export function evaluateSemanticAssertions(assertions = [], runtimeEvidence = null) {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    return {
      evaluated: false,
      passed: false,
      total: 0,
      verifiedCount: 0,
      details: [],
    };
  }

  // 独立证据门禁：只有 controllerConnected === true 且具备合法 Verified 级别的 runtime FactEvidence 时才允许评估
  const runtimeLevel = runtimeEvidence?.evidence?.level;
  const isVerifiedRuntime =
    Boolean(runtimeEvidence) &&
    runtimeEvidence.controllerConnected === true &&
    runtimeEvidence.evidence &&
    typeof runtimeEvidence.evidence === 'object' &&
    runtimeEvidence.evidence.level === 'Verified' &&
    typeof runtimeEvidence.evidence.source === 'string' &&
    runtimeEvidence.evidence.source.trim().length > 0;

  if (!isVerifiedRuntime) {
    return {
      evaluated: false,
      passed: false,
      total: assertions.length,
      verifiedCount: 0,
      details: assertions.map((a) => ({
        assertion: a.assertion,
        identity: a.identity || a.groupIdentity || '',
        passed: false,
        reason:
          !runtimeEvidence || runtimeEvidence.controllerConnected === false
            ? 'Controller unreachable or runtime evidence missing'
            : `Runtime evidence is not Verified (level: "${runtimeLevel || 'missing'}"); cannot evaluate semantic assertions`,
      })),
    };
  }

  const runningRules = Array.isArray(runtimeEvidence.rules) ? runtimeEvidence.rules : [];
  const runningProxies = runtimeEvidence.proxies || {};

  const details = [];
  let verifiedCount = 0;

  for (const rawAssertion of assertions) {
    const assertion = validateSemanticAssertion(rawAssertion);

    if (assertion.assertion === 'rule_present') {
      const { identity, expectedTarget } = assertion;
      let matched = false;

      for (const rule of runningRules) {
        if (typeof rule === 'string') {
          // 字符串规则格式: "TYPE,payload,target" (>=3 parts) 或 "TYPE,target" (2 parts)
          const parts = rule.split(',').map((p) => p.trim());
          if (parts.length >= 2) {
            const ruleType = parts[0];
            const rulePayload = parts.length > 2 ? parts[1] : null;
            const ruleTarget = parts.length > 2 ? parts[2] : parts[1];
            const ruleIdentity = rulePayload ? `${ruleType},${rulePayload}` : ruleType;

            if (ruleIdentity === identity && ruleTarget === expectedTarget) {
              matched = true;
              break;
            }
          }
        } else if (rule && typeof rule === 'object') {
          // 对象规则格式: { type, payload, proxy/target }
          const ruleType = rule.type ? String(rule.type).trim() : '';
          const rulePayload = rule.payload ? String(rule.payload).trim() : null;
          const ruleTarget = (rule.proxy || rule.target) ? String(rule.proxy || rule.target).trim() : '';
          const ruleIdentity = rulePayload ? `${ruleType},${rulePayload}` : ruleType;

          if (ruleIdentity === identity && ruleTarget === expectedTarget) {
            matched = true;
            break;
          }
        }
      }

      if (matched) {
        verifiedCount++;
        details.push({
          assertion: 'rule_present',
          identity,
          passed: true,
        });
      } else {
        details.push({
          assertion: 'rule_present',
          identity,
          passed: false,
          reason: `Rule matching "${identity}" targeting "${expectedTarget}" not found in active runtime`,
        });
      }
    } else if (assertion.assertion === 'group_exists') {
      const { groupIdentity } = assertion;
      let exists = false;

      if (Array.isArray(runningProxies)) {
        exists = runningProxies.some((p) => p && (p.name === groupIdentity || p === groupIdentity));
      } else if (typeof runningProxies === 'object') {
        exists = Object.prototype.hasOwnProperty.call(runningProxies, groupIdentity);
      }

      if (exists) {
        verifiedCount++;
        details.push({
          assertion: 'group_exists',
          identity: groupIdentity,
          passed: true,
        });
      } else {
        details.push({
          assertion: 'group_exists',
          identity: groupIdentity,
          passed: false,
          reason: `Policy group "${groupIdentity}" not found in active proxies`,
        });
      }
    }
  }

  const passed = verifiedCount === assertions.length;

  return {
    evaluated: true,
    passed,
    total: assertions.length,
    verifiedCount,
    details,
  };
}

/**
 * 执行纯逻辑操作状态对账 (Reconcile Operation)
 *
 * @param {object} options
 * @param {object} options.operation ChangeOperation 对象
 * @param {object} options.observation PlatformObservationBundle 平台观测包
 * @param {Array<object>} [options.assertions=[]] 声明式语义断言列表
 * @param {object | null} [options.runtimeEvidence=null] 运行态物证快照
 * @param {object | null} [options.recoveryContext=null] 恢复资格物证上下文
 * @returns {{
 *   activationOutcome: 'Applied' | 'SavedOnly' | 'Conflict' | 'Unchanged' | 'Unknown',
 *   nextAction: 'none' | 'reconcile' | 'manual_required' | 'guided_recovery',
 *   evidenceSummary: object,
 *   recoveryPlan: object | null
 * }}
 */
export function reconcileOperation({
  operation,
  observation,
  assertions = [],
  runtimeEvidence = null,
  recoveryContext = null,
}) {
  if (!operation || typeof operation !== 'object') {
    throw new Error('reconcileOperation requires a valid operation object');
  }
  validateObservationBundle(observation);

  assertSha256Hex(operation.candidateDigest, 'operation.candidateDigest');
  assertSha256Hex(operation.baseDigest, 'operation.baseDigest');

  const candidateDigest = operation.candidateDigest.toLowerCase();
  const baseDigest = operation.baseDigest.toLowerCase();
  const attemptResult = operation.attemptResult;
  const currentDigest = observation.targetDigest?.value
    ? observation.targetDigest.value.toLowerCase()
    : null;
  const targetExists = Boolean(observation.targetDigest?.exists);
  const targetEvidenceLevel = observation.targetDigest?.evidence?.level || 'Unknown';

  // 1. 证据门禁一：Source Digest 必须具备 Verified 级别证据
  // 任何依赖目标源码摘要的终态裁决 (Applied, SavedOnly, Conflict, Unchanged)，若 source digest 证据不足，直接收敛为 Unknown + reconcile
  if (targetEvidenceLevel !== 'Verified') {
    return {
      activationOutcome: 'Unknown',
      nextAction: 'reconcile',
      evidenceSummary: {
        sourceDigestMatchedCandidate: false,
        sourceDigestMatchedBase: false,
        semanticAssertionsPassed: false,
        semanticAssertionsTotal: assertions.length,
        semanticAssertionsVerified: 0,
        assertionDetails: [],
        driftDetected: false,
        insufficientEvidence: true,
        recoveryEligible: false,
        detail: `Source digest evidence level is "${targetEvidenceLevel}" (non-Verified); cannot prove terminal outcome without Verified source evidence.`,
      },
      recoveryPlan: null,
    };
  }

  // 2. 评估声明式语义断言
  const assertionReport = evaluateSemanticAssertions(assertions, runtimeEvidence);

  // 3. 核心状态对比指标
  const sourceDigestMatchedCandidate = currentDigest !== null && currentDigest === candidateDigest;
  const sourceDigestMatchedBase = currentDigest !== null && currentDigest === baseDigest;

  // 4. 外部冲突与并发漂移检测 (Conflict Detection)
  // 目标文件存在且当前摘要既非 base 也非 candidate -> 发生外部第三方冲突修改
  if (targetExists && currentDigest !== null && !sourceDigestMatchedCandidate && !sourceDigestMatchedBase) {
    return {
      activationOutcome: 'Conflict',
      nextAction: 'manual_required',
      evidenceSummary: {
        sourceDigestMatchedCandidate: false,
        sourceDigestMatchedBase: false,
        semanticAssertionsPassed: false,
        semanticAssertionsTotal: assertionReport.total,
        semanticAssertionsVerified: assertionReport.verifiedCount,
        assertionDetails: assertionReport.details,
        driftDetected: true,
        insufficientEvidence: false,
        recoveryEligible: false,
        detail:
          `External drift detected: verified target digest (${currentDigest}) ` +
          `matches neither base (${baseDigest}) nor candidate (${candidateDigest}).`,
      },
      recoveryPlan: null,
    };
  }

  // 5. 候选已完全落盘场景 (Candidate Digest Matched)
  if (sourceDigestMatchedCandidate) {
    const immediateRequired = operation.changeIntent?.immediateActivationRequired !== false;

    // 门禁：立即激活意图下，空断言不能假定为已生效，必须报 Unknown + reconcile
    if (immediateRequired && assertions.length === 0) {
      return {
        activationOutcome: 'Unknown',
        nextAction: 'reconcile',
        evidenceSummary: {
          sourceDigestMatchedCandidate: true,
          sourceDigestMatchedBase: false,
          semanticAssertionsPassed: false,
          semanticAssertionsTotal: 0,
          semanticAssertionsVerified: 0,
          assertionDetails: [],
          driftDetected: false,
          insufficientEvidence: true,
          recoveryEligible: false,
          detail: 'Immediate activation required but zero semantic assertions provided to verify active runtime.',
        },
        recoveryPlan: null,
      };
    }

    // 门禁：运行态证据必须具备 Verified 级别证据
    const runtimeEvidenceLevel = runtimeEvidence?.evidence?.level || 'Unknown';
    if (!assertionReport.evaluated || !runtimeEvidence || runtimeEvidence.controllerConnected === false) {
      return {
        activationOutcome: 'Unknown',
        nextAction: 'reconcile',
        evidenceSummary: {
          sourceDigestMatchedCandidate: true,
          sourceDigestMatchedBase: false,
          semanticAssertionsPassed: false,
          semanticAssertionsTotal: assertionReport.total,
          semanticAssertionsVerified: assertionReport.verifiedCount,
          assertionDetails: assertionReport.details,
          driftDetected: false,
          insufficientEvidence: true,
          recoveryEligible: false,
          detail: 'Candidate artifact verified on disk, but runtime controller evidence is unreachable or missing.',
        },
        recoveryPlan: null,
      };
    }

    if (runtimeEvidenceLevel !== 'Verified') {
      return {
        activationOutcome: 'Unknown',
        nextAction: 'reconcile',
        evidenceSummary: {
          sourceDigestMatchedCandidate: true,
          sourceDigestMatchedBase: false,
          semanticAssertionsPassed: false,
          semanticAssertionsTotal: assertionReport.total,
          semanticAssertionsVerified: assertionReport.verifiedCount,
          assertionDetails: assertionReport.details,
          driftDetected: false,
          insufficientEvidence: true,
          recoveryEligible: false,
          detail: `Runtime evidence level is "${runtimeEvidenceLevel}" (non-Verified); cannot prove Applied without Verified runtime evidence.`,
        },
        recoveryPlan: null,
      };
    }

    // 运行态证据为 Verified 且断言全部通过 -> Applied
    if (assertionReport.passed) {
      return {
        activationOutcome: 'Applied',
        nextAction: 'none',
        evidenceSummary: {
          sourceDigestMatchedCandidate: true,
          sourceDigestMatchedBase: false,
          semanticAssertionsPassed: true,
          semanticAssertionsTotal: assertionReport.total,
          semanticAssertionsVerified: assertionReport.verifiedCount,
          assertionDetails: assertionReport.details,
          driftDetected: false,
          insufficientEvidence: false,
          recoveryEligible: false,
          detail: 'Verified runtime evidence confirms all semantic assertions are satisfied and candidate digest matches.',
        },
        recoveryPlan: null,
      };
    }

    // 运行态已 Verified 但语义断言未满足 -> SavedOnly
    if (!immediateRequired) {
      // 显式允许延迟激活的特例：收敛为 none
      return {
        activationOutcome: 'SavedOnly',
        nextAction: 'none',
        evidenceSummary: {
          sourceDigestMatchedCandidate: true,
          sourceDigestMatchedBase: false,
          semanticAssertionsPassed: false,
          semanticAssertionsTotal: assertionReport.total,
          semanticAssertionsVerified: assertionReport.verifiedCount,
          assertionDetails: assertionReport.details,
          driftDetected: false,
          insufficientEvidence: false,
          recoveryEligible: false,
          detail: 'Source candidate verified on disk, runtime not active, but intent explicitly permits deferred activation.',
        },
        recoveryPlan: null,
      };
    }

    // 默认要求立即生效：严格评估恢复资格 (Recovery Eligibility)
    // 铁律：必须同时证明四项正面事实，仅有 LKG digest 或 cvrExceptionLogged 绝不授权恢复！
    const effectiveRecoveryCtx = recoveryContext || operation.recoveryContext || null;
    const hasLastKnownGood = Boolean(operation.lastKnownGoodDigest);

    const recoveryEligible = Boolean(
      hasLastKnownGood &&
      effectiveRecoveryCtx?.failureAttributableToOperation === true &&
      effectiveRecoveryCtx?.lastKnownGoodAcceptedSnapshot === true &&
      effectiveRecoveryCtx?.snapshotDigestConsistent === true &&
      effectiveRecoveryCtx?.noExternalConflict === true
    );

    let recoveryPlan = null;
    let nextAction = 'manual_required';

    if (recoveryEligible) {
      nextAction = 'guided_recovery';
      recoveryPlan = {
        eligible: true,
        targetDigest: currentDigest,
        restoreToDigest: operation.lastKnownGoodDigest,
        action: 'GUIDED_RESTORE_TO_ACCEPTED_BASELINE',
      };
    }

    return {
      activationOutcome: 'SavedOnly',
      nextAction,
      evidenceSummary: {
        sourceDigestMatchedCandidate: true,
        sourceDigestMatchedBase: false,
        semanticAssertionsPassed: false,
        semanticAssertionsTotal: assertionReport.total,
        semanticAssertionsVerified: assertionReport.verifiedCount,
        assertionDetails: assertionReport.details,
        driftDetected: false,
        insufficientEvidence: false,
        recoveryEligible,
        detail:
          'Candidate source verified on disk, but active runtime semantics are absent. ' +
          (recoveryEligible
            ? 'Fully proven recovery eligibility authorizes guided recovery to accepted baseline.'
            : 'Recovery criteria not fully proven or absent baseline; manual intervention required.'),
      },
      recoveryPlan,
    };
  }

  // 6. 源码仍处于 Base 状态场景 (Base Digest Matched)
  if (sourceDigestMatchedBase) {
    const hasPreEffectProof = Boolean(operation.closureMetadata?.preEffectProof === true);

    // 铁律：只有具备明确 no-effect / pre-effect 正面证明时才能输出 Unchanged
    if (hasPreEffectProof) {
      return {
        activationOutcome: 'Unchanged',
        nextAction: 'none',
        evidenceSummary: {
          sourceDigestMatchedCandidate: false,
          sourceDigestMatchedBase: true,
          semanticAssertionsPassed: false,
          semanticAssertionsTotal: assertionReport.total,
          semanticAssertionsVerified: assertionReport.verifiedCount,
          assertionDetails: assertionReport.details,
          driftDetected: false,
          insufficientEvidence: false,
          recoveryEligible: false,
          detail: `Operation ${attemptResult} with verified pre-effect proof that target source remained on base without mutation.`,
        },
        recoveryPlan: null,
      };
    }

    // 缺乏明确 preEffectProof：
    // 特别是 submitted / no_response，即使观察到 Verified base digest 也绝对不能判 Unchanged，必须 Unknown + reconcile
    return {
      activationOutcome: 'Unknown',
      nextAction: 'reconcile',
      evidenceSummary: {
        sourceDigestMatchedCandidate: false,
        sourceDigestMatchedBase: true,
        semanticAssertionsPassed: false,
        semanticAssertionsTotal: assertionReport.total,
        semanticAssertionsVerified: assertionReport.verifiedCount,
        assertionDetails: assertionReport.details,
        driftDetected: false,
        insufficientEvidence: true,
        recoveryEligible: false,
        detail: `Verified base observed on disk for attemptResult "${attemptResult}", but lacks explicit pre-effect proof. Outcome remains Unknown pending reconciliation.`,
      },
      recoveryPlan: null,
    };
  }

  // 7. 用户取消但未决场景 (cancelled + unresolved)
  if (attemptResult === 'cancelled') {
    return {
      activationOutcome: 'Unknown',
      nextAction: 'reconcile',
      evidenceSummary: {
        sourceDigestMatchedCandidate: false,
        sourceDigestMatchedBase: false,
        semanticAssertionsPassed: false,
        semanticAssertionsTotal: assertionReport.total,
        semanticAssertionsVerified: assertionReport.verifiedCount,
        assertionDetails: assertionReport.details,
        driftDetected: false,
        insufficientEvidence: true,
        recoveryEligible: false,
        detail: 'Operation was cancelled, but insufficient evidence to confirm target source remained unchanged.',
      },
      recoveryPlan: null,
    };
  }

  // 8. 丢包与超时场景 (no_response)
  if (attemptResult === 'no_response') {
    return {
      activationOutcome: 'Unknown',
      nextAction: 'reconcile',
      evidenceSummary: {
        sourceDigestMatchedCandidate: false,
        sourceDigestMatchedBase: false,
        semanticAssertionsPassed: false,
        semanticAssertionsTotal: assertionReport.total,
        semanticAssertionsVerified: assertionReport.verifiedCount,
        assertionDetails: assertionReport.details,
        driftDetected: false,
        insufficientEvidence: true,
        recoveryEligible: false,
        detail: 'Response lost or timed out; cannot infer outcome without further positive observation. Reconcile required.',
      },
      recoveryPlan: null,
    };
  }

  // 9. 默认兜底：证据不足
  return {
    activationOutcome: 'Unknown',
    nextAction: 'reconcile',
    evidenceSummary: {
      sourceDigestMatchedCandidate: false,
      sourceDigestMatchedBase: false,
      semanticAssertionsPassed: false,
      semanticAssertionsTotal: assertionReport.total,
      semanticAssertionsVerified: assertionReport.verifiedCount,
      assertionDetails: assertionReport.details,
      driftDetected: false,
      insufficientEvidence: true,
      recoveryEligible: false,
      detail: `Insufficient positive evidence to determine activation outcome (target evidence: ${targetEvidenceLevel}).`,
    },
    recoveryPlan: null,
  };
}
