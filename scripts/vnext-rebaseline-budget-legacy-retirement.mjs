import { createHash } from 'node:crypto';
import {
  designScopeContractPath,
  parseDesignScopeContract,
} from './vnext-rebaseline-budget-design-scope.mjs';

export const legacyRetirementContractPath = 'scripts/vnext-rebaseline-budget.v8.json';
export const legacyRetirementProtocol = 'combo.vnext-rebaseline-budget/8';

export const legacyV7Lock = Object.freeze({
  protocol: 'combo.vnext-rebaseline-budget/7',
  repository: 'dangdang-tech/Combo',
  targetBranch: 'main',
  contractPath: designScopeContractPath,
  contractSha256: 'f8019c915f928b599eb3afeba637f0e08fd60c14fef71cc10c4c29dfb049f2ff',
  baseSha: '39e5b1b5c281c864a62974a15b51b6d0572cf6d0',
  headSha: '0b0d25eccb70ec5e1beb898fe70f05059fe417eb',
  rawDiffSha256: '0790bf91bb8c59e6c7c735b98251ff7d778e82861ade55645db1887c975420dc',
  changedFiles: 129,
  changedLines: 14615,
  additions: 13454,
  deletions: 1161,
  maxChangedLinesPerFile: 826,
});

export const legacyRetirementDeletionRoots = Object.freeze([
  'apps/authoring/src/modules/capability/',
  'apps/authoring/src/modules/task/',
  'apps/authoring/src/platform/infra/llm/',
  'apps/authoring/src/platform/sse/',
  'apps/authoring/src/platform/text/',
  'apps/runtime-web/',
  'apps/runtime/',
  'apps/sandboxd/',
  'apps/web/src/pages/capabilities/',
  'apps/web/src/pages/public/',
  'apps/web/src/pages/release/',
  'apps/web/src/pages/tasks/',
  'infra/k8s/overlays/sandbox-tools-fifth-slot/',
  'infra/k8s/overlays/sandbox-tools/',
  'packages/shared/src/ports/',
]);

export const legacyRetirementDeletionFiles = Object.freeze([
  'apps/authoring/src/__tests__/agent-package-release.test.ts',
  'apps/authoring/src/__tests__/capability-repo.test.ts',
  'apps/authoring/src/__tests__/connect-script-brand.test.ts',
  'apps/authoring/src/__tests__/connect-script.test.ts',
  'apps/authoring/src/__tests__/env-agent-package-release.test.ts',
  'apps/authoring/src/__tests__/extract.test.ts',
  'apps/authoring/src/__tests__/fakes.ts',
  'apps/authoring/src/__tests__/pairing.test.ts',
  'apps/authoring/src/__tests__/pipeline.test.ts',
  'apps/authoring/src/__tests__/task-service.test.ts',
  'apps/authoring/src/modules/agent-package-release/routes.ts',
  'apps/authoring/src/modules/agent-package-release/service.ts',
  'apps/authoring/src/platform/infra/llm-gateway.ts',
  'apps/authoring/src/platform/infra/lock.ts',
  'apps/authoring/src/platform/infra/queue.ts',
  'apps/authoring/src/processes/worker.ts',
  'apps/web/public/combo-color-card.html',
  'apps/web/public/combo-design-language.html',
  'apps/web/src/api/endpoints.ts',
  'apps/web/src/api/useTaskEvents.test.tsx',
  'apps/web/src/api/useTaskEvents.ts',
  'apps/web/src/components/ErrorState.tsx',
  'apps/web/src/components/LoadingState.tsx',
  'apps/web/src/components/SlowHint.tsx',
  'apps/web/src/components/index.ts',
  'apps/web/src/shell/AccountMenu.test.tsx',
  'apps/web/src/shell/AccountMenu.tsx',
  'apps/web/src/shell/ProtectedLayout.tsx',
  'apps/web/src/shell/Shell.test.tsx',
  'apps/web/src/shell/Shell.tsx',
  'apps/web/src/shell/account.tsx',
  'apps/web/src/shell/icons.tsx',
  'apps/web/src/shell/routes.test.ts',
  'apps/web/src/shell/routes.ts',
  'apps/web/src/shell/useCollapse.test.ts',
  'apps/web/src/shell/useCollapse.ts',
  'apps/web/src/test/fixtures.ts',
  'apps/web/src/test/mockFetchEventSource.ts',
  'docs/diagrams/combo-upload-first-run.mmd',
  'docs/diagrams/combo-upload-recovery.mmd',
  'docs/feishu-upload-sequence.xml',
  'infra/Dockerfile.runtime',
  'infra/Dockerfile.sandboxd',
  'infra/host/release/combo-test-s3-forward.service',
  'infra/k8s/redis-queue.yaml',
  'infra/k8s/release/base/apps/runtime-release.patch.yaml',
  'infra/k8s/release/base/apps/worker-release.patch.yaml',
  'infra/k8s/runtime.yaml',
  'infra/k8s/worker.yaml',
  'infra/redis/redis-queue.conf',
  'packages/shared/src/__tests__/knowledge.test.ts',
  'packages/shared/src/__tests__/redaction.test.ts',
  'packages/shared/src/__tests__/shared.test.ts',
  'packages/shared/src/core/progress.ts',
  'packages/shared/src/core/sse.ts',
  'packages/shared/src/domains/capability.ts',
  'packages/shared/src/domains/knowledge.ts',
  'packages/shared/src/domains/redaction.ts',
  'packages/shared/src/domains/task.ts',
  'packages/shared/src/domains/trial.ts',
  'scripts/acceptance-smoke.sh',
  'scripts/combo-dev-public-s3-smoke.py',
  'scripts/integration/redis-dual.sh',
  'scripts/integration/sandbox-tools-local.sh',
]);

export const legacyRetirementEditableFiles = Object.freeze([
  '.env.compose.example',
  '.env.local.example',
  '.github/workflows/ci.yml',
  'CLAUDE.md',
  'ENGINEERING.md',
  'README.md',
  'apps/authoring/README.md',
  'apps/authoring/package.json',
  'apps/authoring/src/README.md',
  'apps/authoring/src/__tests__/README.md',
  'apps/authoring/src/__tests__/account-auth.pg.test.ts',
  'apps/authoring/src/__tests__/account-auth.test.ts',
  'apps/authoring/src/__tests__/account-service.test.ts',
  'apps/authoring/src/__tests__/auth-session.test.ts',
  'apps/authoring/src/__tests__/env-auth.test.ts',
  'apps/authoring/src/__tests__/observability-redaction.test.ts',
  'apps/authoring/src/__tests__/redis-recovery.test.ts',
  'apps/authoring/src/__tests__/routes.test.ts',
  'apps/authoring/src/__tests__/version.test.ts',
  'apps/authoring/src/bootstrap/README.md',
  'apps/authoring/src/bootstrap/app.ts',
  'apps/authoring/src/bootstrap/routes.ts',
  'apps/authoring/src/index.ts',
  'apps/authoring/src/modules/README.md',
  'apps/authoring/src/modules/agent-package-release/README.md',
  'apps/authoring/src/modules/billing/README.md',
  'apps/authoring/src/platform/README.md',
  'apps/authoring/src/platform/config/README.md',
  'apps/authoring/src/platform/config/env.ts',
  'apps/authoring/src/platform/http/README.md',
  'apps/authoring/src/platform/http/client-events.ts',
  'apps/authoring/src/platform/http/fastify.ts',
  'apps/authoring/src/platform/http/health.ts',
  'apps/authoring/src/platform/infra/README.md',
  'apps/authoring/src/platform/infra/db.ts',
  'apps/authoring/src/platform/infra/index.ts',
  'apps/authoring/src/platform/infra/object-store.ts',
  'apps/authoring/src/platform/infra/redis.ts',
  'apps/authoring/src/platform/middleware/README.md',
  'apps/authoring/src/platform/middleware/auth.ts',
  'apps/authoring/src/platform/observability/README.md',
  'apps/authoring/src/platform/observability/node.ts',
  'apps/authoring/src/processes/README.md',
  'apps/authoring/src/processes/api.ts',
  'apps/web/package.json',
  'apps/web/src/App.landing.test.tsx',
  'apps/web/src/App.tsx',
  'apps/web/src/api/auth.test.ts',
  'apps/web/src/api/client.test.ts',
  'apps/web/src/api/index.ts',
  'apps/web/src/api/sessionLogout.test.ts',
  'apps/web/src/api/sessionLogout.ts',
  'apps/web/src/api/telemetry.ts',
  'apps/web/src/main.tsx',
  'apps/web/src/pages/LoginPage.test.tsx',
  'apps/web/src/pages/LoginPage.tsx',
  'apps/web/src/pages/index.tsx',
  'apps/web/src/safeReturnTo.test.ts',
  'apps/web/src/safeReturnTo.ts',
  'apps/web/src/shell/PublicLayout.test.tsx',
  'apps/web/src/shell/PublicLayout.tsx',
  'apps/web/src/shell/auth.test.tsx',
  'apps/web/src/shell/releaseIdentity.test.tsx',
  'apps/web/src/styles.css',
  'apps/web/src/test/setup.ts',
  'apps/web/src/test/smoke.test.tsx',
  'docs/deployment-topology.md',
  'docs/leshouying-test-acceptance.md',
  'docs/reliable-development-and-preview.md',
  'eslint.config.js',
  'infra/Dockerfile.api',
  'infra/Dockerfile.web',
  'infra/README.md',
  'infra/docker-compose.dev-test.yml',
  'infra/docker-compose.prod.yml',
  'infra/docker-compose.yml',
  'infra/entrypoint.sh',
  'infra/host/release/README.md',
  'infra/k8s/README.md',
  'infra/k8s/api.yaml',
  'infra/k8s/environments/shared-foundation/kustomization.yaml',
  'infra/k8s/environments/test-foundation/kustomization.yaml',
  'infra/k8s/job-minio-init.yaml',
  'infra/k8s/redis-hot.yaml',
  'infra/k8s/release/base/apps/kustomization.yaml',
  'infra/k8s/web.yaml',
  'infra/minio/init-buckets.sh',
  'infra/nginx.conf',
  'infra/package.json',
  'infra/redis/redis-hot.conf',
  'infra/web-runtime-config.sh',
  'package.json',
  'packages/shared/README.md',
  'packages/shared/package.json',
  'packages/shared/src/README.md',
  'packages/shared/src/__tests__/README.md',
  'packages/shared/src/__tests__/auth.test.ts',
  'packages/shared/src/__tests__/pending-recovery.test.ts',
  'packages/shared/src/constants/README.md',
  'packages/shared/src/constants/routes.ts',
  'packages/shared/src/core/README.md',
  'packages/shared/src/core/errors.ts',
  'packages/shared/src/core/health.ts',
  'packages/shared/src/core/index.ts',
  'packages/shared/src/domains/README.md',
  'packages/shared/src/domains/auth.ts',
  'packages/shared/src/domains/index.ts',
  'packages/shared/src/domains/pending-recovery.ts',
  'packages/shared/src/index.ts',
  'playwright.config.ts',
  'pnpm-lock.yaml',
  'scripts/README.md',
  'scripts/check-production-artifacts.sh',
  'scripts/deploy-env.sh',
  'scripts/environment-boundary-contract.test.mjs',
  'scripts/integration/resend-auth-e2e.sh',
  'scripts/migrate-v2-host.sh',
  'scripts/migrate-v2-host.test.mjs',
  'scripts/package.json',
  'scripts/release-manifest.mjs',
  'scripts/render-env.mjs',
  'scripts/render-env.test.mjs',
  'scripts/smoke.sh',
  'scripts/start.sh',
  'scripts/tsconfig.json',
  'scripts/web-asset-manifest.mjs',
  'tests/e2e/README.md',
  'tests/e2e/resend-auth.spec.ts',
  'tsconfig.e2e.json',
  'tsconfig.json',
]);

export const legacyRetirementSentinels = Object.freeze([
  'apps/authoring/src/modules/capability/routes.ts',
  'apps/authoring/src/modules/task/routes.ts',
  'apps/runtime-web/package.json',
  'apps/runtime/package.json',
  'apps/runtime/src/bootstrap/routes.ts',
  'apps/sandboxd/go.mod',
  'apps/web/src/pages/capabilities/CapabilitiesPage.tsx',
  'apps/web/src/pages/tasks/TasksPage.tsx',
  'infra/k8s/overlays/sandbox-tools/kustomization.yaml',
]);

export const legacyRetirementLimits = Object.freeze({
  maxEditableFiles: 110,
  maxEditableAdditions: 1000,
  maxEditableChangedLines: 6500,
  maxChangedLinesPerEditableFile: 1200,
});

// Locked from the immutable v8 base after the retirement manifest was finalized.
export const legacyRetirementInventoryLock = Object.freeze({
  algorithm: 'sha256',
  files: 364,
  bytes: 3072884,
  lines: 84744,
  digest: 'sha256:3d5d7320464a15c63b49008b1278a430e916358587572dcc564d7c72228c110a',
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  invariant(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function safePath(value, { prefix = false } = {}) {
  invariant(typeof value === 'string' && value.length > 0, 'retirement path must be non-empty');
  invariant(
    !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value.includes('//'),
    `${value} is not a safe retirement path`,
  );
  const segments = value.split('/').filter(Boolean);
  invariant(!segments.includes('.') && !segments.includes('..'), `${value} is unsafe`);
  invariant(prefix === value.endsWith('/'), `${value} has the wrong path kind`);
}

function exactSortedPaths(values, expected, label, options) {
  invariant(Array.isArray(values), `${label} must be an array`);
  for (const value of values) safePath(value, options);
  invariant(new Set(values).size === values.length, `${label} contains duplicates`);
  equal(values, [...values].sort(), `${label} must be sorted`);
  equal(values, expected, `${label} changed`);
}

export function isLegacyRetirementDeletionPath(path) {
  return (
    legacyRetirementDeletionFiles.includes(path) ||
    legacyRetirementDeletionRoots.some((prefix) => path.startsWith(prefix))
  );
}

export function createRetirementInventoryReceipt(entries) {
  const canonicalEntries = entries.map((entry) => ({
    path: entry.path,
    mode: entry.mode,
    type: entry.type,
    object: entry.object,
    bytes: entry.bytes,
    lines: entry.lines,
  }));
  equal(
    canonicalEntries.map(({ path }) => path),
    canonicalEntries.map(({ path }) => path).sort(),
    'retirement inventory must be sorted',
  );
  invariant(
    new Set(canonicalEntries.map(({ path }) => path)).size === canonicalEntries.length,
    'retirement inventory contains duplicate paths',
  );
  for (const entry of canonicalEntries) {
    safePath(entry.path);
    invariant(
      isLegacyRetirementDeletionPath(entry.path),
      `inventory path is outside deletion scope: ${entry.path}`,
    );
    invariant(entry.type === 'blob', `inventory entry is not a blob: ${entry.path}`);
    invariant(
      entry.mode === '100644' || entry.mode === '100755',
      `inventory entry has unsafe mode: ${entry.path}`,
    );
    invariant(/^[0-9a-f]{40}$/u.test(entry.object), `inventory object is invalid: ${entry.path}`);
    invariant(
      Number.isSafeInteger(entry.bytes) && entry.bytes >= 0,
      `inventory bytes are invalid: ${entry.path}`,
    );
    invariant(
      Number.isSafeInteger(entry.lines) && entry.lines >= 0,
      `inventory lines are invalid: ${entry.path}`,
    );
  }
  const bytes = canonicalEntries.reduce((sum, entry) => sum + entry.bytes, 0);
  const lines = canonicalEntries.reduce((sum, entry) => sum + entry.lines, 0);
  const digest = createHash('sha256')
    .update(`${JSON.stringify(canonicalEntries)}\n`)
    .digest('hex');
  return {
    algorithm: 'sha256',
    files: canonicalEntries.length,
    bytes,
    lines,
    digest: `sha256:${digest}`,
  };
}

export function parseLegacyRetirementContract({
  source,
  archivedDesignSource,
  archivedTrancheSource,
  archivedBudget,
}) {
  invariant(
    createHash('sha256').update(archivedDesignSource).digest('hex') === legacyV7Lock.contractSha256,
    'legacy v7 contract bytes changed',
  );
  const archivedDesign = parseDesignScopeContract(
    archivedDesignSource,
    archivedTrancheSource,
    archivedBudget,
  );
  const value = JSON.parse(source);
  invariant(
    source === `${JSON.stringify(value, null, 2)}\n`,
    'v8 contract must be canonical JSON with one trailing newline',
  );
  equal(
    Object.keys(value),
    ['protocol', 'schemaVersion', 'scopeId', 'trancheId', 'baseSha', 'legacyV7', 'retirement'],
    'v8 contract keys or key order changed',
  );
  invariant(value.protocol === legacyRetirementProtocol, 'v8 protocol changed');
  invariant(value.schemaVersion === 8, 'v8 schemaVersion changed');
  invariant(value.scopeId === 'legacy-product-retirement-v8', 'v8 scopeId changed');
  invariant(value.trancheId === 'legacy-retirement', 'v8 trancheId changed');
  invariant(value.baseSha === legacyV7Lock.headSha, 'v8 base must equal the locked Main SHA');
  equal(value.legacyV7, legacyV7Lock, 'legacy v7 receipt changed');
  equal(
    Object.keys(value.retirement),
    [
      'protocol',
      'inventory',
      'sentinels',
      'deletionOnlyRoots',
      'deletionOnlyFiles',
      'editableFiles',
      'limits',
    ],
    'retirement manifest keys or key order changed',
  );
  invariant(
    value.retirement.protocol === 'combo.legacy-product-retirement/1',
    'retirement protocol changed',
  );
  equal(value.retirement.inventory, legacyRetirementInventoryLock, 'retirement inventory changed');
  exactSortedPaths(value.retirement.sentinels, legacyRetirementSentinels, 'sentinels');
  exactSortedPaths(
    value.retirement.deletionOnlyRoots,
    legacyRetirementDeletionRoots,
    'deletionOnlyRoots',
    { prefix: true },
  );
  exactSortedPaths(
    value.retirement.deletionOnlyFiles,
    legacyRetirementDeletionFiles,
    'deletionOnlyFiles',
  );
  exactSortedPaths(value.retirement.editableFiles, legacyRetirementEditableFiles, 'editableFiles');
  equal(value.retirement.limits, legacyRetirementLimits, 'retirement limits changed');
  invariant(
    legacyRetirementSentinels.every((path) => isLegacyRetirementDeletionPath(path)),
    'every retirement sentinel must be deletion-only',
  );
  invariant(
    legacyRetirementDeletionFiles.every(
      (path) => !legacyRetirementDeletionRoots.some((prefix) => path.startsWith(prefix)),
    ),
    'retirement deletion files overlap a deletion root',
  );
  invariant(
    legacyRetirementEditableFiles.every((path) => !isLegacyRetirementDeletionPath(path)),
    'retirement editable files overlap deletion scope',
  );
  return {
    ...archivedDesign,
    protocol: value.protocol,
    schemaVersion: value.schemaVersion,
    scopeId: value.scopeId,
    trancheId: value.trancheId,
    baseSha: value.baseSha,
    legacyV7: value.legacyV7,
    retirement: value.retirement,
  };
}

export function verifyLegacyV7Receipt({ source, committedSource, entries, rawDiffSha256 }) {
  invariant(
    createHash('sha256').update(source).digest('hex') === legacyV7Lock.contractSha256,
    'legacy v7 contract bytes changed',
  );
  invariant(source === committedSource, 'legacy v7 contract must match its locked Main head');
  const totals = {
    changedFiles: entries.length,
    changedLines: entries.reduce((sum, entry) => sum + entry.changedLines, 0),
    additions: entries.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: entries.reduce((sum, entry) => sum + entry.deletions, 0),
    maxChangedLinesPerFile: entries.reduce(
      (maximum, entry) => Math.max(maximum, entry.changedLines),
      0,
    ),
  };
  invariant(rawDiffSha256 === legacyV7Lock.rawDiffSha256, 'legacy v7 raw diff receipt changed');
  for (const [field, actual] of Object.entries(totals))
    invariant(actual === legacyV7Lock[field], `legacy v7 ${field} receipt changed`);
  return { verified: true, headSha: legacyV7Lock.headSha, ...totals };
}

export function classifyLegacyRetirementState({ expectedPaths, comparisonPaths, candidatePaths }) {
  const expected = [...expectedPaths].sort();
  const comparison = [...comparisonPaths].sort();
  const candidate = [...candidatePaths].sort();
  invariant(
    expected.length === legacyRetirementInventoryLock.files,
    'locked retirement inventory file count changed',
  );
  invariant(
    comparison.length === 0 || JSON.stringify(comparison) === JSON.stringify(expected),
    'retirement comparison base has partial or drifted inventory',
  );
  invariant(
    candidate.length === 0 || JSON.stringify(candidate) === JSON.stringify(expected),
    'retirement candidate has partial, added, or drifted inventory',
  );
  if (comparison.length === expected.length && candidate.length === expected.length)
    return 'PENDING';
  if (comparison.length === expected.length && candidate.length === 0) return 'RETIREMENT';
  if (comparison.length === 0 && candidate.length === 0) return 'CONSUMED';
  throw new Error('retirement tombstones cannot be resurrected');
}

export function assessLegacyRetirement({
  entries,
  expectedDeletionPaths,
  expectedDeletionInventory,
  sentinelsAtBase,
}) {
  equal(
    [...expectedDeletionPaths].sort(),
    [...expectedDeletionPaths],
    'expected retirement inventory must be sorted',
  );
  const expectedByPath = new Map(expectedDeletionInventory.map((entry) => [entry.path, entry]));
  invariant(
    expectedByPath.size === expectedDeletionPaths.length,
    'expected retirement inventory metadata is incomplete',
  );
  const zeroObject = '0'.repeat(40);
  const deletions = [];
  const editable = [];
  for (const entry of entries) {
    if (isLegacyRetirementDeletionPath(entry.path)) {
      const expected = expectedByPath.get(entry.path);
      invariant(
        expected !== undefined &&
          entry.status === 'D' &&
          entry.additions === 0 &&
          entry.oldMode === expected.mode &&
          entry.oldObject === expected.object &&
          entry.newMode === '000000' &&
          entry.newObject === zeroObject,
        `retirement deletion must be the locked ordinary blob becoming absent: ${entry.path}`,
      );
      deletions.push(entry);
      continue;
    }
    invariant(
      legacyRetirementEditableFiles.includes(entry.path),
      `path is outside the legacy retirement manifest: ${entry.path}`,
    );
    invariant(
      entry.status === 'M' &&
        (entry.oldMode === '100644' || entry.oldMode === '100755') &&
        entry.newMode === entry.oldMode &&
        /^[0-9a-f]{40}$/u.test(entry.oldObject) &&
        entry.oldObject !== zeroObject &&
        /^[0-9a-f]{40}$/u.test(entry.newObject) &&
        entry.newObject !== zeroObject,
      `retirement editable file must be a same-mode ordinary blob modification: ${entry.path}`,
    );
    editable.push(entry);
  }
  equal(
    deletions.map(({ path }) => path).sort(),
    expectedDeletionPaths,
    'retirement must delete the complete locked inventory',
  );
  invariant(
    legacyRetirementSentinels.every((path) => sentinelsAtBase.includes(path)),
    'retirement base is missing required sentinels',
  );
  invariant(
    legacyRetirementSentinels.every((path) => deletions.some((entry) => entry.path === path)),
    'retirement candidate still contains a required sentinel',
  );
  const excludedDeletionLines = deletions.reduce((sum, entry) => sum + entry.deletions, 0);
  invariant(
    deletions.length === legacyRetirementInventoryLock.files &&
      excludedDeletionLines === legacyRetirementInventoryLock.lines,
    'retirement deletion totals do not match the locked inventory',
  );
  invariant(
    editable.length <= legacyRetirementLimits.maxEditableFiles,
    'retirement editable-file budget exceeded',
  );
  const editableAdditions = editable.reduce((sum, entry) => sum + entry.additions, 0);
  const editableChangedLines = editable.reduce((sum, entry) => sum + entry.changedLines, 0);
  invariant(
    editableAdditions <= legacyRetirementLimits.maxEditableAdditions,
    'retirement editable-addition budget exceeded',
  );
  invariant(
    editableChangedLines <= legacyRetirementLimits.maxEditableChangedLines,
    'retirement editable changed-line budget exceeded',
  );
  for (const entry of editable)
    invariant(
      entry.changedLines <= legacyRetirementLimits.maxChangedLinesPerEditableFile,
      `retirement per-editable-file budget exceeded: ${entry.path}`,
    );
  return {
    mode: 'LEGACY_RETIREMENT',
    changedFiles: entries.length,
    changedLines: entries.reduce((sum, entry) => sum + entry.changedLines, 0),
    excludedDeletionFiles: deletions.length,
    excludedDeletionLines,
    editableFiles: editable.length,
    editableAdditions,
    editableChangedLines,
  };
}
