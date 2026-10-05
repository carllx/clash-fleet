import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AttemptResult,
  ActivationOutcome,
  NextAction,
  validateStateInvariants,
  reconcileContractState,
} from './support/contract-oracle.js';

describe('Phase A: Contract State-Model Acceptance Suite', () => {
  describe('Three-Dimensional Model Enums & Orthogonality', () => {
    it('defines the complete canonical Attempt Result enum', () => {
      assert.deepEqual(Object.values(AttemptResult).sort(), [
        'awaiting_user',
        'busy',
        'cancelled',
        'failed',
        'no_response',
        'not_started',
        'skipped',
        'submitted',
      ]);
    });

    it('defines the complete canonical Activation Outcome enum', () => {
      assert.deepEqual(Object.values(ActivationOutcome).sort(), [
        'Applied',
        'Conflict',
        'SavedOnly',
        'Unchanged',
        'Unknown',
      ]);
    });

    it('defines the complete canonical Next Action enum', () => {
      assert.deepEqual(Object.values(NextAction).sort(), [
        'guided_recovery',
        'manual_required',
        'none',
        'reconcile',
      ]);
    });
  });

  describe('Load-Bearing Invariants from Issue #16', () => {
    it('Invariant 1: Applied activation must strictly converge to next_action: none', () => {
      const validApplied = {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.APPLIED,
        nextAction: NextAction.NONE,
      };
      assert.equal(validateStateInvariants(validApplied).valid, true);

      const invalidApplied = {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.APPLIED,
        nextAction: NextAction.RECONCILE,
      };
      const result = validateStateInvariants(invalidApplied);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.includes('Applied activation must converge')));
    });

    it('Invariant 2: no_response is non-terminal and strictly requires reconciliation', () => {
      const validNoResponse = {
        attempt: AttemptResult.NO_RESPONSE,
        activation: ActivationOutcome.UNKNOWN,
        nextAction: NextAction.RECONCILE,
      };
      assert.equal(validateStateInvariants(validNoResponse).valid, true);

      const invalidNoResponse = {
        attempt: AttemptResult.NO_RESPONSE,
        activation: ActivationOutcome.UNKNOWN,
        nextAction: NextAction.NONE,
      };
      const result = validateStateInvariants(invalidNoResponse);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.includes('no_response must not converge')));
    });

    it('Invariant 3a: Immediate-activation SavedOnly must default to manual_required (not none)', () => {
      const stateWithNone = {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.SAVED_ONLY,
        nextAction: NextAction.NONE,
      };
      // 默认要求当前立即生效时不允许为 none
      const result = validateStateInvariants(stateWithNone, { allowDeferredActivation: false });
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.includes('Immediate-activation SavedOnly cannot default')));

      const stateWithManual = {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.SAVED_ONLY,
        nextAction: NextAction.MANUAL_REQUIRED,
      };
      assert.equal(validateStateInvariants(stateWithManual, { allowDeferredActivation: false }).valid, true);
    });

    it('Invariant 3b: Explicitly deferred-activation SavedOnly may converge to next_action: none', () => {
      const stateWithNone = {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.SAVED_ONLY,
        nextAction: NextAction.NONE,
      };
      const result = validateStateInvariants(stateWithNone, { allowDeferredActivation: true });
      assert.equal(result.valid, true);
    });

    it('Invariant 4a: Proven unchanged cancellation resolves to Unchanged + none', () => {
      const state = {
        attempt: AttemptResult.CANCELLED,
        activation: ActivationOutcome.UNCHANGED,
        nextAction: NextAction.NONE,
      };
      assert.equal(validateStateInvariants(state, { provenUnchanged: true }).valid, true);

      const invalidState = {
        attempt: AttemptResult.CANCELLED,
        activation: ActivationOutcome.UNKNOWN,
        nextAction: NextAction.NONE,
      };
      assert.equal(validateStateInvariants(invalidState, { provenUnchanged: true }).valid, false);
    });

    it('Invariant 4b: Cancellation with unverified/insufficient evidence must be Unknown + reconcile', () => {
      const state = {
        attempt: AttemptResult.CANCELLED,
        activation: ActivationOutcome.UNKNOWN,
        nextAction: NextAction.RECONCILE,
      };
      assert.equal(validateStateInvariants(state, { provenUnchanged: false }).valid, true);

      const invalidState = {
        attempt: AttemptResult.CANCELLED,
        activation: ActivationOutcome.UNKNOWN,
        nextAction: NextAction.NONE,
      };
      const result = validateStateInvariants(invalidState, { provenUnchanged: false });
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.includes('Unverified cancellation with Unknown')));
    });

    it('Invariant 5: Target drift (Conflict) must require manual_required', () => {
      const conflictState = {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.CONFLICT,
        nextAction: NextAction.MANUAL_REQUIRED,
      };
      assert.equal(validateStateInvariants(conflictState).valid, true);

      const invalidConflict = {
        attempt: AttemptResult.SUBMITTED,
        activation: ActivationOutcome.CONFLICT,
        nextAction: NextAction.NONE,
      };
      assert.equal(validateStateInvariants(invalidConflict).valid, false);
    });

    it('Invariant 6: Unknown / no_response never means automatic retry', () => {
      const op = {
        id: 'op_test_timeout_01',
        baseDigest: 'sha256:base_aaa',
        candidateDigest: 'sha256:cand_bbb',
      };
      const outcome = reconcileContractState({
        operation: op,
        currentTargetDigest: 'sha256:base_aaa',
        timeoutOccurred: true,
      });

      assert.equal(outcome.attempt, AttemptResult.NO_RESPONSE);
      assert.equal(outcome.activation, ActivationOutcome.UNKNOWN);
      assert.equal(outcome.nextAction, NextAction.RECONCILE);
      assert.equal(outcome.terminal, false);
      assert.equal(outcome.reconciliationRequired, true);
    });
  });
});
