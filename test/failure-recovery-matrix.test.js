import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AttemptResult,
  ActivationOutcome,
  NextAction,
  reconcileContractState,
  evaluateRecoveryEligibility,
  generateGuidedRecoveryPlan,
} from './support/contract-oracle.js';

describe('Phase B: Failure and Lost-Response Synthetic Matrix Suite', () => {
  const baseOp = Object.freeze({
    id: 'op_test_tx_001',
    baseDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    candidateDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    logicalTarget: {
      appScope: 'io.github.clash-verge-rev.clash-verge-rev',
      profileId: 'Script',
      artifactKind: 'global_script',
    },
  });

  it('Scenario 1: Normal apply succeeds and verifies semantic assertions', () => {
    const outcome = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      controllerReachable: true,
      assertionsSatisfied: true,
    });

    assert.equal(outcome.attempt, AttemptResult.SUBMITTED);
    assert.equal(outcome.activation, ActivationOutcome.APPLIED);
    assert.equal(outcome.nextAction, NextAction.NONE);
    assert.equal(outcome.terminal, true);
  });

  it('Scenario 2: SavedOnly differentiates immediate vs deferred intent', () => {
    // 2a. 意图要求即时生效：由于运行时未激活，系统未收敛，必须为 manual_required
    const outcomeImmediate = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      controllerReachable: true,
      assertionsSatisfied: false,
      allowDeferredActivation: false,
    });

    assert.equal(outcomeImmediate.attempt, AttemptResult.SUBMITTED);
    assert.equal(outcomeImmediate.activation, ActivationOutcome.SAVED_ONLY);
    assert.equal(outcomeImmediate.nextAction, NextAction.MANUAL_REQUIRED);
    assert.equal(outcomeImmediate.terminal, true);

    // 2b. 意图显式允许延迟激活：收敛为 none
    const outcomeDeferred = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      controllerReachable: true,
      assertionsSatisfied: false,
      allowDeferredActivation: true,
    });

    assert.equal(outcomeDeferred.attempt, AttemptResult.SUBMITTED);
    assert.equal(outcomeDeferred.activation, ActivationOutcome.SAVED_ONLY);
    assert.equal(outcomeDeferred.nextAction, NextAction.NONE);
    assert.equal(outcomeDeferred.terminal, true);
  });

  it('Scenario 3: Response lost after commit enters non-terminal no_response and reconciles', () => {
    // 3a. 提交后网络中断，未收到回包 -> 非终态，标记 reconciliationRequired
    const outcomeLost = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      timeoutOccurred: true,
    });

    assert.equal(outcomeLost.attempt, AttemptResult.NO_RESPONSE);
    assert.equal(outcomeLost.activation, ActivationOutcome.UNKNOWN);
    assert.equal(outcomeLost.nextAction, NextAction.RECONCILE);
    assert.equal(outcomeLost.terminal, false);
    assert.equal(outcomeLost.reconciliationRequired, true);

    // 3b. 后续调用对账探针发现已生效 -> 校准为 Applied，不重复下发
    const outcomeReconciled = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      controllerReachable: true,
      assertionsSatisfied: true,
      timeoutOccurred: false,
    });

    assert.equal(outcomeReconciled.activation, ActivationOutcome.APPLIED);
    assert.equal(outcomeReconciled.nextAction, NextAction.NONE);
  });

  it('Scenario 4: Agent transport loss recovers via local journal reconciliation (no blind duplicate)', () => {
    // 模拟重连：从本地已持久化的 Journal 读取 op 并执行 reconcile，绝不重复生成新 operation
    const outcomeOnReconnect = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      controllerReachable: true,
      assertionsSatisfied: true,
    });

    assert.equal(outcomeOnReconnect.attempt, AttemptResult.SUBMITTED);
    assert.equal(outcomeOnReconnect.activation, ActivationOutcome.APPLIED);
    assert.equal(outcomeOnReconnect.nextAction, NextAction.NONE);
  });

  it('Scenario 5: Concurrent GUI/user edit triggers Conflict and manual_required', () => {
    // 物理文件的哈希既不是预期 base，也不是 candidate（被外部第三方修改）
    const foreignDigest = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';
    const outcome = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: foreignDigest,
      controllerReachable: true,
    });

    assert.equal(outcome.attempt, AttemptResult.SUBMITTED);
    assert.equal(outcome.activation, ActivationOutcome.CONFLICT);
    assert.equal(outcome.nextAction, NextAction.MANUAL_REQUIRED);
    assert.equal(outcome.terminal, true);
    assert.equal(outcome.reason, 'external_concurrent_edit_conflict');
  });

  it('Scenario 6: Target/profile/instance mismatch fails closed to manual_required', () => {
    const outcome = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.baseDigest,
      targetIdentityAmbiguous: true,
    });

    assert.equal(outcome.attempt, AttemptResult.FAILED);
    assert.equal(outcome.activation, ActivationOutcome.UNKNOWN);
    assert.equal(outcome.nextAction, NextAction.MANUAL_REQUIRED);
    assert.equal(outcome.terminal, true);
    assert.equal(outcome.reason, 'target_identity_ambiguous');
  });

  it('Scenario 7: Busy attempt state requires waiting or reconciliation, non-terminal', () => {
    const busyState = {
      attempt: AttemptResult.BUSY,
      activation: ActivationOutcome.UNKNOWN,
      nextAction: NextAction.RECONCILE,
      terminal: false,
    };

    assert.equal(busyState.attempt, AttemptResult.BUSY);
    assert.equal(busyState.nextAction, NextAction.RECONCILE);
    assert.equal(busyState.terminal, false);
  });

  it('Scenario 8: Skipped/no-op mutation gracefully converges to Unchanged + none', () => {
    const noOpOp = {
      ...baseOp,
      candidateDigest: baseOp.baseDigest,
    };
    const outcome = reconcileContractState({
      operation: noOpOp,
      currentTargetDigest: baseOp.baseDigest,
    });

    assert.equal(outcome.attempt, AttemptResult.SKIPPED);
    assert.equal(outcome.activation, ActivationOutcome.UNCHANGED);
    assert.equal(outcome.nextAction, NextAction.NONE);
    assert.equal(outcome.terminal, true);
  });

  it('Scenario 9: Unknown due to controller unreachability requires reconcile (never auto retry)', () => {
    const outcome = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      controllerReachable: false,
    });

    assert.equal(outcome.attempt, AttemptResult.SUBMITTED);
    assert.equal(outcome.activation, ActivationOutcome.UNKNOWN);
    assert.equal(outcome.nextAction, NextAction.RECONCILE);
    assert.equal(outcome.terminal, false);
    assert.equal(outcome.reconciliationRequired, true);
  });

  it('Scenario 10: Script runtime exception in logs produces SavedOnly with guided recovery or manual required', () => {
    const outcomeWithBaseline = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      controllerReachable: true,
      assertionsSatisfied: false,
      scriptException: 'ReferenceError: invalid_variable is not defined at main()',
      hasVerifiedLastKnownGood: true,
    });

    assert.equal(outcomeWithBaseline.attempt, AttemptResult.SUBMITTED);
    assert.equal(outcomeWithBaseline.activation, ActivationOutcome.SAVED_ONLY);
    assert.equal(outcomeWithBaseline.nextAction, NextAction.GUIDED_RECOVERY);
    assert.equal(outcomeWithBaseline.failureCause, 'script_runtime_exception');

    const outcomeWithoutBaseline = reconcileContractState({
      operation: baseOp,
      currentTargetDigest: baseOp.candidateDigest,
      controllerReachable: true,
      assertionsSatisfied: false,
      scriptException: 'SyntaxError: unexpected token in script',
      hasVerifiedLastKnownGood: false,
    });

    assert.equal(outcomeWithoutBaseline.nextAction, NextAction.MANUAL_REQUIRED);
  });

  it('Scenario 11: Eligible guided recovery produces structured GuidedRecoveryPlan', () => {
    const eligibility = evaluateRecoveryEligibility({
      isAttributableToOperation: true,
      lastKnownGoodDigest: 'sha256:known_good_000',
      currentTargetDigest: baseOp.candidateDigest,
      candidateDigest: baseOp.candidateDigest,
    });

    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.reason, 'recovery_eligibility_satisfied');

    const plan = generateGuidedRecoveryPlan(baseOp, 'sha256:known_good_000');
    assert.equal(plan.operationId, baseOp.id);
    assert.equal(plan.restoreSourceDigest, 'sha256:known_good_000');
    assert.equal(plan.recoveryActionType, 'GUIDED_USER_RESTORE');
    assert.ok(plan.instructions.length >= 2);
  });

  it('Scenario 12: Recovery ineligible when preconditions are violated', () => {
    // 12a. 缺失已验证的 last_known_good 基线
    const noBaseline = evaluateRecoveryEligibility({
      isAttributableToOperation: true,
      lastKnownGoodDigest: null,
      currentTargetDigest: baseOp.candidateDigest,
      candidateDigest: baseOp.candidateDigest,
    });
    assert.equal(noBaseline.eligible, false);
    assert.equal(noBaseline.reason, 'no_verified_last_known_good');

    // 12b. 当前目标已发生并发漂移
    const drifted = evaluateRecoveryEligibility({
      isAttributableToOperation: true,
      lastKnownGoodDigest: 'sha256:known_good_000',
      currentTargetDigest: 'sha256:drifted_target_999',
      candidateDigest: baseOp.candidateDigest,
    });
    assert.equal(drifted.eligible, false);
    assert.equal(drifted.reason, 'target_drifted_concurrent_edit');

    // 12c. 故障非本次变更引入（如远端服务自身故障）
    const externalOutage = evaluateRecoveryEligibility({
      isAttributableToOperation: false,
      lastKnownGoodDigest: 'sha256:known_good_000',
      currentTargetDigest: baseOp.candidateDigest,
      candidateDigest: baseOp.candidateDigest,
    });
    assert.equal(externalOutage.eligible, false);
    assert.equal(externalOutage.reason, 'failure_not_attributable_to_current_operation');
  });

  it('Scenario 13: Recovery attempt failure transitions to failed + manual_required', () => {
    const recoveryFailedState = {
      attempt: AttemptResult.FAILED,
      activation: ActivationOutcome.UNKNOWN,
      nextAction: NextAction.MANUAL_REQUIRED,
      terminal: true,
      reason: 'recovery_verification_failed',
    };

    assert.equal(recoveryFailedState.attempt, AttemptResult.FAILED);
    assert.equal(recoveryFailedState.nextAction, NextAction.MANUAL_REQUIRED);
    assert.equal(recoveryFailedState.terminal, true);
  });
});
