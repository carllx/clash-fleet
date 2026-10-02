import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyRepoImmutableSetting,
  verifyPublishedReleaseImmutability,
  verifyReleaseAssetsParity,
  assertReleaseImmutabilityGate,
} from '../src/release/immutability-gate.js';

test('GitHub Immutable Releases Isolation Gate Suite', async (t) => {
  await t.test('verifyRepoImmutableSetting tests', async (st) => {
    await st.test('passes when enabled is explicitly true', () => {
      const res = verifyRepoImmutableSetting({ enabled: true, enforced_by_owner: false });
      assert.equal(res.passed, true);
      assert.equal(res.enabled, true);
      assert.match(res.detail, /enabled/i);
    });

    await st.test('fails closed when enabled is explicitly false', () => {
      const res = verifyRepoImmutableSetting({ enabled: false, enforced_by_owner: false });
      assert.equal(res.passed, false);
      assert.equal(res.enabled, false);
      assert.match(res.detail, /disabled \(fail-closed\)/i);
    });

    await st.test('fails closed on null, undefined, or empty payload', () => {
      assert.equal(verifyRepoImmutableSetting(null).passed, false);
      assert.equal(verifyRepoImmutableSetting(undefined).passed, false);
      assert.equal(verifyRepoImmutableSetting({}).passed, false);
      assert.equal(verifyRepoImmutableSetting('invalid').passed, false);
    });

    await st.test('fails closed on malformed or unexpected value types', () => {
      const res = verifyRepoImmutableSetting({ enabled: 'true' }); // string not boolean
      assert.equal(res.passed, false);
      assert.match(res.detail, /unexpected value/i);
    });
  });

  await t.test('verifyPublishedReleaseImmutability tests', async (st) => {
    await st.test('passes when release is published and immutable is true', () => {
      const release = {
        id: 12345,
        tag_name: 'v1.0.0',
        draft: false,
        prerelease: false,
        immutable: true,
      };
      const res = verifyPublishedReleaseImmutability(release);
      assert.equal(res.passed, true);
      assert.equal(res.immutable, true);
    });

    await st.test('fails closed when release is still in draft state even if immutable is marked true', () => {
      const release = {
        id: 12345,
        tag_name: 'v1.0.0',
        draft: true,
        immutable: true,
      };
      const res = verifyPublishedReleaseImmutability(release);
      assert.equal(res.passed, false);
      assert.match(res.reason, /draft state/i);
    });

    await st.test('fails closed when release is published but immutable is false or omitted', () => {
      const release1 = {
        id: 12345,
        tag_name: 'v1.0.0',
        draft: false,
        immutable: false,
      };
      const res1 = verifyPublishedReleaseImmutability(release1);
      assert.equal(res1.passed, false);
      assert.match(res1.reason, /not immutable/i);

      const release2 = {
        id: 12345,
        tag_name: 'v1.0.0',
        draft: false,
      };
      const res2 = verifyPublishedReleaseImmutability(release2);
      assert.equal(res2.passed, false);
      assert.match(res2.reason, /not immutable/i);
    });

    await st.test('fails closed on null or non-object release', () => {
      assert.equal(verifyPublishedReleaseImmutability(null).passed, false);
      assert.equal(verifyPublishedReleaseImmutability(undefined).passed, false);
    });
  });

  await t.test('verifyReleaseAssetsParity tests', async (st) => {
    const expectedChecksums = {
      'Script.js': 'hash-script',
      'RULE_ASSET_PROVENANCE.json': 'hash-prov',
      'SHA256SUMS.txt': 'hash-sums',
    };

    await st.test('passes when release assets match expected files exactly', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json' },
        { name: 'SHA256SUMS.txt' },
        { name: 'Script.js' },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, true);
      assert.deepEqual(res.missing, []);
      assert.deepEqual(res.unexpected, []);
    });

    await st.test('fails closed when expected asset is missing', () => {
      const assets = [
        { name: 'Script.js' },
        { name: 'SHA256SUMS.txt' },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, false);
      assert.deepEqual(res.missing, ['RULE_ASSET_PROVENANCE.json']);
    });

    await st.test('fails closed when unexpected extra asset is present', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json' },
        { name: 'SHA256SUMS.txt' },
        { name: 'Script.js' },
        { name: 'extra-secret.env' },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, false);
      assert.deepEqual(res.unexpected, ['extra-secret.env']);
    });

    await st.test('fails closed when assets parameter is not an array', () => {
      const res = verifyReleaseAssetsParity(null, expectedChecksums);
      assert.equal(res.passed, false);
    });
  });

  await t.test('assertReleaseImmutabilityGate composite gate tests', async (st) => {
    const validRepoSetting = { enabled: true };
    const validRelease = {
      id: 999,
      tag_name: 'v1.0.0',
      draft: false,
      immutable: true,
      assets: [
        { name: 'Script.js' },
        { name: 'RULE_ASSET_PROVENANCE.json' },
        { name: 'SHA256SUMS.txt' },
      ],
    };
    const validChecksums = {
      'Script.js': 'a',
      'RULE_ASSET_PROVENANCE.json': 'b',
      'SHA256SUMS.txt': 'c',
    };

    await st.test('composite gate succeeds when all criteria met', () => {
      const res = assertReleaseImmutabilityGate({
        repoSetting: validRepoSetting,
        releaseObject: validRelease,
        expectedChecksums: validChecksums,
      });
      assert.equal(res.passed, true);
    });

    await st.test('composite gate fails closed on disabled repo setting', () => {
      assert.throws(
        () =>
          assertReleaseImmutabilityGate({
            repoSetting: { enabled: false },
            releaseObject: validRelease,
            expectedChecksums: validChecksums,
          }),
        /\[immutability-gate\] Repository check failed/
      );
    });

    await st.test('composite gate fails closed on non-immutable release object', () => {
      assert.throws(
        () =>
          assertReleaseImmutabilityGate({
            repoSetting: validRepoSetting,
            releaseObject: { ...validRelease, immutable: false },
            expectedChecksums: validChecksums,
          }),
        /\[immutability-gate\] Release check failed/
      );
    });

    await st.test('composite gate fails closed on asset mismatch', () => {
      assert.throws(
        () =>
          assertReleaseImmutabilityGate({
            repoSetting: validRepoSetting,
            releaseObject: { ...validRelease, assets: [{ name: 'Script.js' }] },
            expectedChecksums: validChecksums,
          }),
        /\[immutability-gate\] Assets parity check failed/
      );
    });
  });
});
