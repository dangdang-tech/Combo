import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseAllDocuments } from 'yaml';
import {
  releaseIdForSource,
  releaseManifestDigest,
  serializeReleaseManifest,
} from './release-manifest.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SHA = 'd'.repeat(40);
const digest = (character) => `sha256:${character.repeat(64)}`;
const release = {
  schemaVersion: 1,
  sourceSha: SHA,
  releaseId: releaseIdForSource(SHA),
  images: {
    api: `ghcr.io/dangdang-tech/combo-api@${digest('1')}`,
    runtime: `ghcr.io/dangdang-tech/combo-runtime@${digest('2')}`,
    web: `ghcr.io/dangdang-tech/combo-web@${digest('3')}`,
  },
  migrationHead: '0006_one_running_turn_per_session.sql',
  builtAt: '2026-07-24T08:00:00.000Z',
  webAssetManifest: digest('4'),
};

function render(environment, phase) {
  const directory = mkdtempSync(join(tmpdir(), 'combo-render-test-'));
  const manifest = join(directory, 'release.json');
  const output = join(directory, `${environment}-${phase}.yaml`);
  writeFileSync(manifest, serializeReleaseManifest(release));
  execFileSync(
    process.execPath,
    [
      'scripts/render-release.mjs',
      '--manifest',
      manifest,
      '--manifest-digest',
      releaseManifestDigest(release),
      '--environment',
      environment,
      '--phase',
      phase,
      '--output',
      output,
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  return parseAllDocuments(readFileSync(output, 'utf8')).map((document) => document.toJS());
}

for (const [environment, namespace, prefix] of [
  ['test', 'combo-preview', ''],
  ['preview', 'combo-review', 'release-'],
  ['production', 'combo', 'release-'],
]) {
  test(`${environment} renders exactly the four release business planes`, () => {
    const resources = render(environment, 'apps');
    const deployments = resources
      .filter((resource) => resource.kind === 'Deployment')
      .map((resource) => resource.metadata.name)
      .sort();
    assert.deepEqual(
      deployments,
      ['api', 'runtime', 'web', 'worker'].map((name) => `${prefix}${name}`).sort(),
    );
    assert.equal(
      resources.every((resource) => resource.metadata.namespace === namespace),
      true,
    );
    assert.equal(
      resources.some((resource) => resource.kind === 'Secret'),
      false,
    );
    assert.equal(
      resources
        .filter((resource) => resource.kind === 'Service')
        .some(
          (resource) =>
            resource.spec.type === 'NodePort' ||
            resource.spec.ports.some((port) => port.nodePort !== undefined),
        ),
      false,
    );
    const serialized = JSON.stringify(resources);
    assert.equal(serialized.includes('consumer'), false);
    assert.equal(serialized.includes('sweeper'), false);
    assert.equal(serialized.includes(':latest'), false);
  });

  test(`${environment} renders migration before apps with the API digest`, () => {
    const resources = render(environment, 'migrate');
    assert.equal(resources.length, 1);
    assert.equal(resources[0].kind, 'Job');
    assert.equal(resources[0].metadata.name, `${prefix}migrate`);
    assert.equal(resources[0].metadata.namespace, namespace);
    assert.equal(resources[0].spec.template.spec.containers[0].image, release.images.api);
    assert.equal(
      resources[0].spec.template.metadata.annotations['combo.build/migration-head'],
      release.migrationHead,
    );
  });
}

test('Nginx contract rejects missing hashed assets and defines cache policy', () => {
  const nginx = readFileSync(join(ROOT, 'infra/nginx.conf'), 'utf8');
  assert.match(nginx, /location \^~ \/assets\/[\s\S]*?try_files \$uri =404;/);
  assert.match(nginx, /location \^~ \/try\/assets\/[\s\S]*?try_files \$uri =404;/);
  assert.match(nginx, /public, max-age=31536000, immutable/);
  assert.match(nginx, /no-cache, max-age=0, must-revalidate/);
  assert.match(nginx, /location = \/runtime-config\.json[\s\S]*?no-store/);
  assert.match(nginx, /location = \/version\.json[\s\S]*?no-store/);
});

test('Preview foundation uses new retained names and no legacy NodePort', () => {
  const foundation = render('preview', 'foundation');
  assert.equal(
    foundation.some(
      (resource) =>
        resource.kind === 'StatefulSet' && resource.metadata.name === 'release-postgres',
    ),
    true,
  );
  assert.equal(
    foundation.some(
      (resource) =>
        resource.kind === 'StatefulSet' && resource.metadata.name === 'release-redis-queue',
    ),
    true,
  );
  assert.equal(
    foundation.some(
      (resource) => resource.kind === 'StatefulSet' && resource.metadata.name === 'release-minio',
    ),
    true,
  );
  assert.equal(
    foundation
      .filter((resource) => resource.kind === 'Service')
      .some(
        (resource) =>
          resource.spec.type === 'NodePort' ||
          resource.spec.ports.some((port) => port.nodePort !== undefined),
      ),
    false,
  );
  assert.equal(JSON.stringify(foundation).includes('combo-preview-env'), true);
});

test('Preview bucket initialization targets only the new MinIO service', () => {
  const resources = render('preview', 'init');
  const job = resources.find((resource) => resource.kind === 'Job');
  assert.equal(job.metadata.name, 'release-minio-init');
  assert.match(JSON.stringify(job), /http:\/\/release-minio:9000/);
  assert.equal(JSON.stringify(job).includes('combo-preview-env'), true);
});
