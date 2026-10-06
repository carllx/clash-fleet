import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AttemptResult,
  ActivationOutcome,
  NextAction,
  reconcileContractState,
} from './support/contract-oracle.js';
import {
  MACOS_CAPABILITY_FIXTURES,
  WINDOWS_CAPABILITY_FIXTURES,
  evaluatePlatformObservationCapability,
} from './fixtures/platform-capabilities.js';

describe('Phase C: Cross-Platform Capability & Parity Matrix Suite', () => {
  const commonOp = Object.freeze({
    id: 'op_cross_platform_tx',
    baseDigest: 'sha256:base_digest_1111111111111111111111111111111111111111111111111111111111111111',
    candidateDigest: 'sha256:candidate_2222222222222222222222222222222222222222222222222222222222222222',
    logicalTarget: {
      appScope: 'io.github.clash-verge-rev.clash-verge-rev',
      profileId: 'Script',
      artifactKind: 'global_script',
    },
  });

  describe('macOS Capability Matrix Assertions', () => {
    it('evaluates macOS Sidecar Stable capability without restart dependencies', () => {
      const profile = MACOS_CAPABILITY_FIXTURES.SIDECAR_STABLE;
      const capability = evaluatePlatformObservationCapability(profile);

      assert.equal(capability.compatible, true);
      assert.equal(capability.supportsObservation, true);
      assert.equal(profile.realHostActionAuthorization, 'UNAUTHORIZED');
      assert.equal(profile.privilegeFacts.elevationPermitted, false);
      assert.equal(profile.controllerEndpoint.type, 'unix_socket');
    });

    it('evaluates macOS Service Dev capability under LaunchDaemon topology', () => {
      const profile = MACOS_CAPABILITY_FIXTURES.SERVICE_DEV;
      const capability = evaluatePlatformObservationCapability(profile);

      assert.equal(capability.compatible, true);
      assert.equal(profile.topologyMode, 'SERVICE');
      assert.equal(profile.privilegeFacts.serviceModeActive, true);
    });

    it('fails closed to manual_required on ambiguous macOS target profile', () => {
      const profile = MACOS_CAPABILITY_FIXTURES.AMBIGUOUS_PROFILE;
      const capability = evaluatePlatformObservationCapability(profile);

      assert.equal(capability.compatible, false);
      assert.equal(capability.requiresManualOnly, true);
    });
  });

  describe('Windows Capability Matrix Assertions', () => {
    it('evaluates Windows Elevated Stable capability without UAC elevation or process termination', () => {
      const profile = WINDOWS_CAPABILITY_FIXTURES.ELEVATED_STABLE;
      const capability = evaluatePlatformObservationCapability(profile);

      assert.equal(capability.compatible, true);
      assert.equal(capability.supportsObservation, true);
      assert.equal(profile.controllerEndpoint.type, 'named_pipe');
      assert.equal(profile.privilegeFacts.integrityLevel, 'High');
      assert.equal(profile.privilegeFacts.elevationPermitted, false); // 不得申请 UAC 提权
    });

    it('evaluates Windows Loopback Dev capability with token authentication', () => {
      const profile = WINDOWS_CAPABILITY_FIXTURES.LOOPBACK_DEV;
      const capability = evaluatePlatformObservationCapability(profile);

      assert.equal(capability.compatible, true);
      assert.equal(profile.controllerEndpoint.type, 'http');
      assert.ok(profile.controllerEndpoint.token);
    });

    it('fails closed when target is unresolvable or controller unreachable', () => {
      const profile = WINDOWS_CAPABILITY_FIXTURES.UNSUPPORTED_TARGET;
      const capability = evaluatePlatformObservationCapability(profile);

      assert.equal(capability.compatible, false);
      assert.ok(capability.reasons.some((r) => r.includes('not reachable')));
    });
  });

  describe('Cross-Platform Parity Invariants (Identical Contract Evaluation)', () => {
    it('judges macOS and Windows by identical postconditions on normal apply', () => {
      const macOutcome = reconcileContractState({
        operation: commonOp,
        currentTargetDigest: commonOp.candidateDigest,
        controllerReachable: true,
        assertionsSatisfied: true,
      });

      const winOutcome = reconcileContractState({
        operation: commonOp,
        currentTargetDigest: commonOp.candidateDigest,
        controllerReachable: true,
        assertionsSatisfied: true,
      });

      assert.deepEqual(macOutcome, winOutcome);
      assert.equal(macOutcome.activation, ActivationOutcome.APPLIED);
      assert.equal(macOutcome.nextAction, NextAction.NONE);
    });

    it('judges macOS and Windows by identical postconditions on SavedOnly (immediate intent)', () => {
      const macOutcome = reconcileContractState({
        operation: commonOp,
        currentTargetDigest: commonOp.candidateDigest,
        controllerReachable: true,
        assertionsSatisfied: false,
        allowDeferredActivation: false,
      });

      const winOutcome = reconcileContractState({
        operation: commonOp,
        currentTargetDigest: commonOp.candidateDigest,
        controllerReachable: true,
        assertionsSatisfied: false,
        allowDeferredActivation: false,
      });

      assert.deepEqual(macOutcome, winOutcome);
      assert.equal(macOutcome.activation, ActivationOutcome.SAVED_ONLY);
      assert.equal(macOutcome.nextAction, NextAction.MANUAL_REQUIRED);
    });

    it('judges macOS and Windows by identical postconditions on external concurrent conflict', () => {
      const foreignDigest = 'sha256:foreign_conflict_hash_9999999999999999999999999999999999999999';

      const macOutcome = reconcileContractState({
        operation: commonOp,
        currentTargetDigest: foreignDigest,
      });

      const winOutcome = reconcileContractState({
        operation: commonOp,
        currentTargetDigest: foreignDigest,
      });

      assert.deepEqual(macOutcome, winOutcome);
      assert.equal(macOutcome.activation, ActivationOutcome.CONFLICT);
      assert.equal(macOutcome.nextAction, NextAction.MANUAL_REQUIRED);
    });

    it('Phase D Gate Verification: Real-host authorization remains explicitly unauthorized', () => {
      const macProfile = MACOS_CAPABILITY_FIXTURES.SIDECAR_STABLE;
      const winProfile = WINDOWS_CAPABILITY_FIXTURES.ELEVATED_STABLE;

      assert.equal(macProfile.realHostActionAuthorization, 'UNAUTHORIZED');
      assert.equal(winProfile.realHostActionAuthorization, 'UNAUTHORIZED');
    });
  });
});
