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
    const HASH_SCRIPT = '1111111111111111111111111111111111111111111111111111111111111111';
    const HASH_PROV = '2222222222222222222222222222222222222222222222222222222222222222';
    const HASH_SUMS = '3333333333333333333333333333333333333333333333333333333333333333';

    const expectedChecksums = {
      'Script.js': HASH_SCRIPT,
      'RULE_ASSET_PROVENANCE.json': HASH_PROV,
      'SHA256SUMS.txt': HASH_SUMS,
    };

    await st.test('passes when release assets have authoritative sha256:<hash> matching exactly', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${HASH_PROV}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
        { name: 'Script.js', digest: `sha256:${HASH_SCRIPT}` },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, true);
      assert.deepEqual(res.missing, []);
      assert.deepEqual(res.unexpected, []);
      assert.deepEqual(res.corrupted, []);
    });

    await st.test('passes with case-insensitive sha256 hex normalization', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `SHA256:${HASH_PROV.toUpperCase()}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
        { name: 'Script.js', digest: `sha256:${HASH_SCRIPT}` },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, true);
    });

    await st.test('fails closed when release asset digest has sha256:<wrong hash>', () => {
      const wrongHash = '4444444444444444444444444444444444444444444444444444444444444444';
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${HASH_PROV}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
        { name: 'Script.js', digest: `sha256:${wrongHash}` },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, false);
      assert.match(res.detail, /corrupted/);
      assert.equal(res.corrupted.length, 1);
    });

    await st.test('fails closed when expected hash exists but remote asset digest is missing', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${HASH_PROV}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
        { name: 'Script.js' }, // missing digest
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, false);
      assert.match(res.detail, /missing digest/i);
      assert.equal(res.corrupted.length, 1);
    });

    await st.test('fails closed on malformed SHA-256 (not 64 hex or non-hex chars)', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${HASH_PROV}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
        { name: 'Script.js', digest: 'sha256:too-short' },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, false);
      assert.match(res.detail, /Malformed SHA-256 digest/i);
    });

    await st.test('fails closed when digest misses algorithm prefix', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${HASH_PROV}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
        { name: 'Script.js', digest: HASH_SCRIPT }, // bare hex without sha256:
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, false);
      assert.match(res.detail, /missing algorithm prefix/i);
    });

    await st.test('fails closed on unsupported digest algorithm (e.g. sha512:)', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${HASH_PROV}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
        { name: 'Script.js', digest: `sha512:${'a'.repeat(128)}` },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, false);
      assert.match(res.detail, /Unsupported digest algorithm: "sha512"/i);
    });

    await st.test('fails closed when expected asset is missing', () => {
      const assets = [
        { name: 'Script.js', digest: `sha256:${HASH_SCRIPT}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
      ];
      const res = verifyReleaseAssetsParity(assets, expectedChecksums);
      assert.equal(res.passed, false);
      assert.deepEqual(res.missing, ['RULE_ASSET_PROVENANCE.json']);
    });

    await st.test('fails closed when unexpected extra asset is present', () => {
      const assets = [
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${HASH_PROV}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
        { name: 'Script.js', digest: `sha256:${HASH_SCRIPT}` },
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
    const HASH_SCRIPT = '1111111111111111111111111111111111111111111111111111111111111111';
    const HASH_PROV = '2222222222222222222222222222222222222222222222222222222222222222';
    const HASH_SUMS = '3333333333333333333333333333333333333333333333333333333333333333';

    const validRepoSetting = { enabled: true };
    const validRelease = {
      id: 999,
      tag_name: 'v1.0.0',
      draft: false,
      immutable: true,
      assets: [
        { name: 'Script.js', digest: `sha256:${HASH_SCRIPT}` },
        { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${HASH_PROV}` },
        { name: 'SHA256SUMS.txt', digest: `sha256:${HASH_SUMS}` },
      ],
    };
    const validChecksums = {
      'Script.js': HASH_SCRIPT,
      'RULE_ASSET_PROVENANCE.json': HASH_PROV,
      'SHA256SUMS.txt': HASH_SUMS,
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
            releaseObject: { ...validRelease, assets: [{ name: 'Script.js', digest: `sha256:${HASH_SCRIPT}` }] },
            expectedChecksums: validChecksums,
          }),
        /\[immutability-gate\] Assets parity check failed/
      );
    });
  });
});
