/**
 * 测试专用契约预言机与规范状态判定模型 (Contract Test Oracle & State Model)
 *
 * 依据 Issue #16 最小安全应用与恢复契约规范 (docs/spec/minimal-safe-apply-recovery-contract.md)，
 * 为 Issue #17 跨平台合成验收测试提供标准状态定义、收敛约束判定及恢复资格裁决。
 *
 * 注意：本模块为测试支撑组件 (Test Support Only)，严禁作为生产抽象导出。
 */

/**
 * 动作执行状态 (Attempt Result)
 * 记录执行动作这一层发生了什么（与操作通道/适配方式解耦）
 */
export const AttemptResult = Object.freeze({
  NOT_STARTED: 'not_started',
  AWAITING_USER: 'awaiting_user',
  SUBMITTED: 'submitted',
  BUSY: 'busy',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  NO_RESPONSE: 'no_response',
  CANCELLED: 'cancelled',
});

/**
 * 运行时激活判定 (Activation Outcome)
 * 严格描述 Fleet 通过只读证据最终对实际状态能够证明什么
 */
export const ActivationOutcome = Object.freeze({
  APPLIED: 'Applied',
  SAVED_ONLY: 'SavedOnly',
  CONFLICT: 'Conflict',
  UNCHANGED: 'Unchanged',
  UNKNOWN: 'Unknown',
});

/**
 * 后续处置行动 (Next Action)
 * 独立于执行状态与证明状态的正交维度，约束系统后续控制流
 */
export const NextAction = Object.freeze({
  NONE: 'none',
  RECONCILE: 'reconcile',
  MANUAL_REQUIRED: 'manual_required',
  GUIDED_RECOVERY: 'guided_recovery',
});

/**
 * 校验三维状态元组的合法性与收敛不变量
 *
 * @param {object} state
 * @param {string} state.attempt
 * @param {string} state.activation
 * @param {string} state.nextAction
 * @param {object} [options]
 * @param {boolean} [options.allowDeferredActivation=false] 变更意图是否明确允许延迟激活
 * @param {boolean} [options.provenUnchanged=false] 是否已证明系统绝对未变
 * @returns {{ valid: boolean, violations: string[] }}
 */
export function validateStateInvariants(state, options = {}) {
  const violations = [];
  const { attempt, activation, nextAction } = state;

  if (!Object.values(AttemptResult).includes(attempt)) {
    violations.push(`Invalid attempt result: ${attempt}`);
  }
  if (!Object.values(ActivationOutcome).includes(activation)) {
    violations.push(`Invalid activation outcome: ${activation}`);
  }
  if (!Object.values(NextAction).includes(nextAction)) {
    violations.push(`Invalid next action: ${nextAction}`);
  }

  // 不变量 1: Applied 必须收敛至 none
  if (activation === ActivationOutcome.APPLIED && nextAction !== NextAction.NONE) {
    violations.push(`Applied activation must converge to next_action: none, got: ${nextAction}`);
  }

  // 不变量 2: no_response 绝不能直接作为收敛终态，必须要求对账
  if (attempt === AttemptResult.NO_RESPONSE && nextAction === NextAction.NONE) {
    violations.push(`no_response must not converge to next_action: none without reconciliation`);
  }

  // 不变量 3: SavedOnly 处置约束
  if (activation === ActivationOutcome.SAVED_ONLY) {
    if (options.allowDeferredActivation) {
      if (nextAction !== NextAction.NONE && nextAction !== NextAction.MANUAL_REQUIRED) {
        violations.push(`Deferred SavedOnly must resolve to none or manual_required, got: ${nextAction}`);
      }
    } else {
      // 默认要求当前立即生效时，SavedOnly 必须为 manual_required (或符合恢复资格时的 guided_recovery)
      if (nextAction === NextAction.NONE) {
        violations.push(`Immediate-activation SavedOnly cannot default to next_action: none`);
      }
    }
  }

  // 不变量 4: 取消场景收敛约束
  if (attempt === AttemptResult.CANCELLED) {
    if (options.provenUnchanged) {
      if (activation !== ActivationOutcome.UNCHANGED || nextAction !== NextAction.NONE) {
        violations.push(`Proven unchanged cancellation must be Unchanged + none`);
      }
    } else {
      // 未能证明未变时，必须保持 Unknown + reconcile
      if (activation === ActivationOutcome.UNKNOWN && nextAction === NextAction.NONE) {
        violations.push(`Unverified cancellation with Unknown activation must not use next_action: none`);
      }
    }
  }

  // 不变量 5: Conflict 必须转入 manual_required
  if (activation === ActivationOutcome.CONFLICT && nextAction !== NextAction.MANUAL_REQUIRED) {
    violations.push(`Conflict activation must require manual_required`);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * 契约预言机对账计算函数
 * 模拟根据只读观察与意图事实生成规范判定结果
 *
 * @param {object} params
 * @param {object} params.operation 变更操作数据
 * @param {string} params.currentTargetDigest 当前目标文件的物理 SHA-256
 * @param {boolean} [params.controllerReachable=true] External Controller 是否可达
 * @param {boolean} [params.assertionsSatisfied=false] 声明式语义断言是否全部满足
 * @param {string|null} [params.scriptException=null] 运行日志记录的脚本异常
 * @param {boolean} [params.userCancelled=false] 用户是否选择取消
 * @param {boolean} [params.timeoutOccurred=false] 是否发生超时未收到回包
 * @param {boolean} [params.allowDeferredActivation=false] 是否显式允许延迟激活
 * @param {boolean} [params.targetIdentityAmbiguous=false] 目标标识是否存在歧义
 * @param {boolean} [params.hasVerifiedLastKnownGood=false] 是否存在已验证的已知良好基线
 * @returns {object} 判定的三维状态及补充元数据
 */
export function reconcileContractState(params) {
  const {
    operation,
    currentTargetDigest,
    controllerReachable = true,
    assertionsSatisfied = false,
    scriptException = null,
    userCancelled = false,
    timeoutOccurred = false,
    allowDeferredActivation = false,
    targetIdentityAmbiguous = false,
    hasVerifiedLastKnownGood = false,
  } = params;

  // 1. 目标标识存在歧义 -> Fail-Closed 阻断
  if (targetIdentityAmbiguous) {
    return {
      attempt: AttemptResult.FAILED,
      activation: ActivationOutcome.UNKNOWN,
      nextAction: NextAction.MANUAL_REQUIRED,
      terminal: true,
      reason: 'target_identity_ambiguous',
    };
  }

  // 2. 超时未收到回包 -> no_response (非终态，必须通过对账推进)
  if (timeoutOccurred) {
    return {
      attempt: AttemptResult.NO_RESPONSE,
      activation: ActivationOutcome.UNKNOWN,
      nextAction: NextAction.RECONCILE,
      terminal: false,
      reconciliationRequired: true,
      reason: 'timeout_awaiting_response',
    };
  }

  // 3. 用户主动取消
  if (userCancelled) {
    const isUnchanged = currentTargetDigest === operation.baseDigest;
    if (isUnchanged) {
      return {
        attempt: AttemptResult.CANCELLED,
        activation: ActivationOutcome.UNCHANGED,
        nextAction: NextAction.NONE,
        terminal: true,
        reason: 'cancelled_proven_unchanged',
      };
    }
    // 未能证明未变或现场证据不足
    return {
      attempt: AttemptResult.CANCELLED,
      activation: ActivationOutcome.UNKNOWN,
      nextAction: NextAction.RECONCILE,
      terminal: false,
      reconciliationRequired: true,
      reason: 'cancelled_unverified_state',
    };
  }

  // 4. No-op 变更 (候选哈希与当前基线完全一致)
  if (operation.candidateDigest === operation.baseDigest) {
    return {
      attempt: AttemptResult.SKIPPED,
      activation: ActivationOutcome.UNCHANGED,
      nextAction: NextAction.NONE,
      terminal: true,
      reason: 'no_op_skipped',
    };
  }

  // 5. 并发冲突检测：当前物理摘要既不等于 base，也不等于 candidate
  if (currentTargetDigest !== operation.baseDigest && currentTargetDigest !== operation.candidateDigest) {
    return {
      attempt: AttemptResult.SUBMITTED,
      activation: ActivationOutcome.CONFLICT,
      nextAction: NextAction.MANUAL_REQUIRED,
      terminal: true,
      reason: 'external_concurrent_edit_conflict',
    };
  }

  // 6. 源码匹配 candidate，进一步检验运行时事实
  if (currentTargetDigest === operation.candidateDigest) {
    // 观测不足（例如无法连接 Controller）
    if (!controllerReachable) {
      return {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.UNKNOWN,
        nextAction: NextAction.RECONCILE,
        terminal: false,
        reconciliationRequired: true,
        reason: 'controller_unreachable',
      };
    }

    // 运行日志记录脚本异常（静默降级）
    if (scriptException) {
      const nextAction = hasVerifiedLastKnownGood
        ? NextAction.GUIDED_RECOVERY
        : NextAction.MANUAL_REQUIRED;
      return {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.SAVED_ONLY,
        nextAction,
        terminal: true,
        failureCause: 'script_runtime_exception',
        details: scriptException,
      };
    }

    // 语义断言验证通过
    if (assertionsSatisfied) {
      return {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.APPLIED,
        nextAction: NextAction.NONE,
        terminal: true,
        reason: 'semantic_assertions_verified',
      };
    }

    // 源码已保存，但断言未生效（例如被 CVR 跳过 reload）
    const nextAction = allowDeferredActivation
      ? NextAction.NONE
      : NextAction.MANUAL_REQUIRED;

    return {
      attempt: AttemptResult.SUBMITTED,
      activation: ActivationOutcome.SAVED_ONLY,
      nextAction,
      terminal: true,
      reason: 'runtime_not_active',
    };
  }

  // 7. 源码仍等于 base（未发生物理修改）
  return {
    attempt: AttemptResult.AWAITING_USER,
    activation: ActivationOutcome.UNCHANGED,
    nextAction: NextAction.RECONCILE,
    terminal: false,
    reason: 'awaiting_mutation',
  };
}

/**
 * 恢复资格评估器
 * 必须严格满足三门禁：
 * 1. 异常明确归因于本次变更 (attributable)
 * 2. 存在有效且哈希一致的 last_known_good (hasVerifiedLastKnownGood)
 * 3. 目标未发生新的外部并发冲突 (currentTargetDigest === candidateDigest)
 *
 * @param {object} params
 * @param {string} params.failureCause 故障原因
 * @param {boolean} params.isAttributableToOperation 是否可归因于本次变更
 * @param {string|null} params.lastKnownGoodDigest 已知良好基线摘要
 * @param {string} params.currentTargetDigest 当前目标摘要
 * @param {string} params.candidateDigest 本次候选摘要
 * @returns {{ eligible: boolean, reason: string }}
 */
export function evaluateRecoveryEligibility(params) {
  const {
    isAttributableToOperation,
    lastKnownGoodDigest,
    currentTargetDigest,
    candidateDigest,
  } = params;

  if (!isAttributableToOperation) {
    return {
      eligible: false,
      reason: 'failure_not_attributable_to_current_operation',
    };
  }

  if (!lastKnownGoodDigest) {
    return {
      eligible: false,
      reason: 'no_verified_last_known_good',
    };
  }

  if (currentTargetDigest !== candidateDigest) {
    return {
      eligible: false,
      reason: 'target_drifted_concurrent_edit',
    };
  }

  return {
    eligible: true,
    reason: 'recovery_eligibility_satisfied',
  };
}

/**
 * 生成带校验的引导式恢复方案 (Guided Recovery Plan)
 *
 * @param {object} operation
 * @param {string} lastKnownGoodDigest
 * @returns {object}
 */
export function generateGuidedRecoveryPlan(operation, lastKnownGoodDigest) {
  return {
    operationId: operation.id,
    targetLogicalId: operation.logicalTarget?.profileId ?? 'Script',
    restoreSourceDigest: lastKnownGoodDigest,
    recoveryActionType: 'GUIDED_USER_RESTORE',
    instructions: [
      '在 CVR 原生界面中打开对应配置项',
      `将内容恢复为快照基准 (${lastKnownGoodDigest})`,
      '保存并通知 Fleet 重新执行对账验证',
    ],
  };
}
