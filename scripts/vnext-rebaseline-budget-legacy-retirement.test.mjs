import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assessLegacyRetirement,
  classifyLegacyRetirementState,
  createRetirementInventoryReceipt,
  isLegacyRetirementDeletionPath,
  legacyRetirementContractPath,
  legacyRetirementDeletionFiles,
  legacyRetirementEditableFiles,
  legacyRetirementInventoryLock,
  legacyRetirementLimits,
  legacyRetirementSentinels,
  legacyV7Lock,
  parseLegacyRetirementContract,
  verifyLegacyV7Receipt,
} from './vnext-rebaseline-budget-legacy-retirement.mjs';
import {
  activeContractPath,
  assessCumulative,
  assessPullRequest,
  archivedBudgetPath,
  archivedDesignPolicyPaths,
  contractPath as archivedDesignContractPath,
  isAtomicLegacyRetirementSource,
  parseContract,
  parseNumstat,
  parseStatusEntries,
  policyPaths,
  resolveBudgetRepoRoot,
} from './vnext-rebaseline-budget.mjs';
import { trancheContractPath } from './vnext-rebaseline-budget-tranche.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', ...options });
const archivedBudgetSource = readFileSync(join(repo, archivedBudgetPath), 'utf8');
const archivedBudget = parseContract(archivedBudgetSource);
const archivedTrancheSource = readFileSync(join(repo, trancheContractPath), 'utf8');
const archivedDesignSource = readFileSync(join(repo, archivedDesignContractPath), 'utf8');
const source = readFileSync(join(repo, legacyRetirementContractPath), 'utf8');
const contract = parseLegacyRetirementContract({
  source,
  archivedDesignSource,
  archivedTrancheSource,
  archivedBudget,
});

const zeroObject = '0'.repeat(40);
const addedDeletionOnlyPaths = Object.freeze([
  'apps/web/src/api/client.test.ts',
  'apps/web/src/pages/landing/landingDraft.test.ts',
  'apps/web/src/pages/landing/landingDraft.ts',
  'apps/web/src/safeReturnTo.test.ts',
  'apps/web/src/safeReturnTo.ts',
  'infra/host/release/combo-preview-minio-forward.service',
  'infra/host/release/combo-prod-minio-forward.service',
  'packages/creator-agent-protocol/src/__tests__/agent-package-capability-contract.test.ts',
  'packages/creator-agent-protocol/src/__tests__/knowledge-bundle-contract.test.ts',
  'packages/creator-agent-protocol/src/agent-package-capability.ts',
  'packages/creator-agent-protocol/src/knowledge-bundle.ts',
  'packages/shared/src/core/pagination.ts',
]);
const addedEditablePaths = Object.freeze([
  'apps/web/index.html',
  'apps/web/src/api/client.ts',
  'apps/web/src/pages/landing/LandingPage.test.tsx',
  'apps/web/src/shell/useDocumentTitle.ts',
  'apps/web/src/test/renderWithProviders.tsx',
  'docs/payment-sdk-integration.md',
  'infra/k8s/minio.yaml',
  'infra/k8s/observability/README.md',
  'packages/creator-agent-protocol/README.md',
  'packages/creator-agent-protocol/package.json',
  'packages/creator-agent-protocol/src/README.md',
  'packages/creator-agent-protocol/src/__tests__/README.md',
  'packages/shared/src/core/envelope.ts',
  'pnpm-workspace.yaml',
]);

function changed(path, status = 'M', additions = 1, deletions = 0, raw = {}) {
  return {
    path,
    status,
    additions,
    deletions,
    changedLines: additions + deletions,
    oldMode: status === 'A' ? '000000' : '100644',
    newMode: status === 'D' ? '000000' : '100644',
    oldObject: status === 'A' ? zeroObject : '1'.repeat(40),
    newObject: status === 'D' ? zeroObject : '2'.repeat(40),
    ...raw,
  };
}

function baseInventory() {
  const records = git(['ls-tree', '-r', '-z', '--long', legacyV7Lock.headSha])
    .split('\0')
    .filter(Boolean);
  const entries = [];
  for (const record of records) {
    const match = /^(\d+) (\w+) ([0-9a-f]{40})\s+(\d+)\t(.+)$/u.exec(record);
    assert.notEqual(match, null);
    const [, mode, type, object, bytesText, path] = match;
    if (!isLegacyRetirementDeletionPath(path)) continue;
    const blob = execFileSync('git', ['cat-file', 'blob', object], { cwd: repo });
    let lines = blob.length === 0 || blob.at(-1) === 10 ? 0 : 1;
    for (const byte of blob) if (byte === 10) lines += 1;
    entries.push({ path, mode, type, object, bytes: Number(bytesText), lines });
  }
  return entries.sort(({ path: left }, { path: right }) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

const inventory = baseInventory();
const inventoryPaths = inventory.map(({ path }) => path);
const deletionEntries = inventory.map(({ path, lines, mode, object }) =>
  changed(path, 'D', 0, lines, { oldMode: mode, oldObject: object }),
);

function retirementContext(overrides = {}) {
  return {
    retirementState: 'RETIREMENT',
    expectedDeletionPaths: inventoryPaths,
    expectedDeletionInventory: inventory,
    sentinelsAtBase: [...legacyRetirementSentinels],
    ...overrides,
  };
}

test('v8 contract is canonical, active, immutable, and retains the normal v7 ceilings', () => {
  assert.equal(activeContractPath, legacyRetirementContractPath);
  assert.equal(source, `${JSON.stringify(JSON.parse(source), null, 2)}\n`);
  assert.equal(contract.protocol, 'combo.vnext-rebaseline-budget/8');
  assert.equal(contract.baseSha, legacyV7Lock.headSha);
  assert.deepEqual(contract.limits, {
    maxChangedFilesPerPullRequest: 30,
    maxChangedLinesPerFile: 1200,
    maxChangedLinesPerPullRequest: 5000,
    maxChangedLinesFromBase: 15000,
  });
  assert.deepEqual(legacyRetirementLimits, {
    maxEditableFiles: 140,
    maxEditableAdditions: 1000,
    maxEditableChangedLines: 8500,
    maxChangedLinesPerEditableFile: 3000,
  });
  assert.ok(policyPaths.includes(legacyRetirementContractPath));
  for (const path of archivedDesignPolicyPaths) assert.ok(policyPaths.includes(path));
  assert.throws(
    () =>
      parseLegacyRetirementContract({
        source: source.replace('"schemaVersion": 8', '"schemaVersion": 8 '),
        archivedDesignSource,
        archivedTrancheSource,
        archivedBudget,
      }),
    /canonical JSON/,
  );
});

test('legacy v7 bytes and complete historical receipt remain live verification', () => {
  const numstat = git([
    'diff',
    '--no-renames',
    '--numstat',
    '-z',
    legacyV7Lock.baseSha,
    legacyV7Lock.headSha,
  ]);
  const names = git([
    'diff',
    '--no-renames',
    '--name-only',
    '-z',
    legacyV7Lock.baseSha,
    legacyV7Lock.headSha,
  ]);
  const raw = execFileSync(
    'git',
    [
      'diff',
      '--raw',
      '-z',
      '--full-index',
      '--no-renames',
      '--abbrev=40',
      legacyV7Lock.baseSha,
      legacyV7Lock.headSha,
    ],
    { cwd: repo },
  );
  const receipt = verifyLegacyV7Receipt({
    source: archivedDesignSource,
    committedSource: git(['show', `${legacyV7Lock.headSha}:${archivedDesignContractPath}`]),
    entries: parseNumstat(numstat, names),
    rawDiffSha256: createHash('sha256').update(raw).digest('hex'),
  });
  assert.deepEqual(
    {
      changedFiles: receipt.changedFiles,
      changedLines: receipt.changedLines,
      additions: receipt.additions,
      deletions: receipt.deletions,
      maxChangedLinesPerFile: receipt.maxChangedLinesPerFile,
    },
    {
      changedFiles: 129,
      changedLines: 14615,
      additions: 13454,
      deletions: 1161,
      maxChangedLinesPerFile: 826,
    },
  );
  assert.throws(
    () =>
      verifyLegacyV7Receipt({
        source: archivedDesignSource.replace('"schemaVersion": 7', '"schemaVersion": 6'),
        committedSource: archivedDesignSource,
        entries: [],
        rawDiffSha256: legacyV7Lock.rawDiffSha256,
      }),
    /legacy v7 contract bytes changed/,
  );
});

test('base inventory canonical digest covers every manifest removal target', () => {
  assert.deepEqual(createRetirementInventoryReceipt(inventory), legacyRetirementInventoryLock);
  assert.deepEqual(legacyRetirementInventoryLock, {
    algorithm: 'sha256',
    files: 376,
    bytes: 3128233,
    lines: 86296,
    digest: 'sha256:75267179e6c467a3340e2c01fa8493b8330b685d9cafb062592682a828b6e2ce',
  });
  assert.equal(inventory.length, 376);
  assert.ok(inventory.every(({ mode, type }) => type === 'blob' && /^100(644|755)$/u.test(mode)));
  assert.ok(legacyRetirementSentinels.every((path) => inventoryPaths.includes(path)));
  assert.throws(
    () => createRetirementInventoryReceipt([...inventory].reverse()),
    /inventory must be sorted/,
  );
});

test('strict PENDING to RETIREMENT to CONSUMED transitions are one-shot', () => {
  assert.equal(
    classifyLegacyRetirementState({
      expectedPaths: inventoryPaths,
      comparisonPaths: inventoryPaths,
      candidatePaths: inventoryPaths,
    }),
    'PENDING',
  );
  assert.equal(
    classifyLegacyRetirementState({
      expectedPaths: inventoryPaths,
      comparisonPaths: inventoryPaths,
      candidatePaths: [],
    }),
    'RETIREMENT',
  );
  assert.equal(
    classifyLegacyRetirementState({
      expectedPaths: inventoryPaths,
      comparisonPaths: [],
      candidatePaths: [],
    }),
    'CONSUMED',
  );
  assert.throws(
    () =>
      classifyLegacyRetirementState({
        expectedPaths: inventoryPaths,
        comparisonPaths: [],
        candidatePaths: inventoryPaths,
      }),
    /resurrected/,
  );
});

test('retirement source shape permits only a staged index or one non-merge product commit', () => {
  const base = 'a'.repeat(40);
  const sourceSha = 'b'.repeat(40);
  assert.equal(
    isAtomicLegacyRetirementSource({
      comparisonBase: base,
      sourceSha: base,
      sourceParents: [],
      sourceCommitCount: 0,
      allowUncommittedIndex: true,
    }),
    true,
  );
  assert.equal(
    isAtomicLegacyRetirementSource({
      comparisonBase: base,
      sourceSha,
      sourceParents: [base],
      sourceCommitCount: 1,
    }),
    true,
  );
  for (const candidate of [
    {
      comparisonBase: base,
      sourceSha: base,
      sourceParents: [],
      sourceCommitCount: 0,
    },
    {
      comparisonBase: base,
      sourceSha,
      sourceParents: [base],
      sourceCommitCount: 2,
    },
    {
      comparisonBase: base,
      sourceSha,
      sourceParents: ['c'.repeat(40)],
      sourceCommitCount: 1,
    },
    {
      comparisonBase: base,
      sourceSha,
      sourceParents: [base, 'c'.repeat(40)],
      sourceCommitCount: 1,
    },
  ])
    assert.equal(isAtomicLegacyRetirementSource(candidate), false);
});

test('PENDING rejects mixed governance and product changes', () => {
  assert.throws(
    () =>
      assessPullRequest(
        contract,
        [changed(legacyRetirementContractPath, 'M'), changed('apps/web/src/App.tsx', 'M')],
        { retirementState: 'PENDING' },
      ),
    /governance-only/,
  );
});

test('RETIREMENT permits only the complete deletion inventory and exact editable files', () => {
  const editablePath = legacyRetirementEditableFiles[0];
  const result = assessPullRequest(
    contract,
    [...deletionEntries, changed(editablePath, 'M', 2, 3)],
    retirementContext(),
  );
  assert.equal(result.mode, 'LEGACY_RETIREMENT');
  assert.equal(result.excludedDeletionFiles, inventory.length);
  assert.equal(result.editableFiles, 1);
  assert.equal(result.editableChangedLines, 5);

  assert.throws(
    () =>
      assessPullRequest(
        contract,
        [...deletionEntries, changed('docs/not-in-retirement.md', 'M')],
        retirementContext(),
      ),
    /outside the legacy retirement manifest/,
  );
  for (const path of policyPaths) {
    assert.throws(
      () =>
        assessPullRequest(contract, [...deletionEntries, changed(path, 'M')], retirementContext()),
      /cannot modify budget policy or the PR gate/,
      path,
    );
  }
});

test('modified legacy files and additions under deletion roots cannot masquerade as retirement', () => {
  const modified = deletionEntries.map((entry, index) =>
    index === 0 ? changed(entry.path, 'M', 1, entry.deletions - 1) : entry,
  );
  assert.throws(
    () => assessLegacyRetirement({ entries: modified, ...retirementContext() }),
    /locked ordinary blob becoming absent/,
  );
  const addedPath = 'apps/runtime/new-runtime.ts';
  assert.throws(
    () =>
      assessLegacyRetirement({
        entries: [...deletionEntries, changed(addedPath, 'A')],
        ...retirementContext(),
      }),
    /locked ordinary blob becoming absent/,
  );
  assert.throws(
    () =>
      classifyLegacyRetirementState({
        expectedPaths: inventoryPaths,
        comparisonPaths: inventoryPaths,
        candidatePaths: [...inventoryPaths.slice(1), addedPath],
      }),
    /partial, added, or drifted inventory/,
  );
});

test('missing sentinels and editable additions or deletions fail closed', () => {
  assert.throws(
    () =>
      assessLegacyRetirement({
        entries: deletionEntries,
        ...retirementContext({ sentinelsAtBase: legacyRetirementSentinels.slice(1) }),
      }),
    /missing required sentinels/,
  );
  for (const status of ['A', 'D']) {
    assert.throws(
      () =>
        assessLegacyRetirement({
          entries: [...deletionEntries, changed(legacyRetirementEditableFiles[0], status)],
          ...retirementContext(),
        }),
      /same-mode ordinary blob modification/,
    );
  }
});

test('retirement verifies locked deletion objects and ordinary same-mode editable blobs', () => {
  const deletion = deletionEntries[0];
  for (const raw of [
    { oldObject: 'f'.repeat(40) },
    { oldMode: '120000' },
    { oldMode: '160000' },
    { newMode: '100644', newObject: 'e'.repeat(40) },
  ]) {
    assert.throws(
      () =>
        assessLegacyRetirement({
          entries: [
            changed(deletion.path, 'D', 0, deletion.deletions, { ...deletion, ...raw }),
            ...deletionEntries.slice(1),
          ],
          ...retirementContext(),
        }),
      /locked ordinary blob becoming absent/,
    );
  }

  const editablePath = legacyRetirementEditableFiles[0];
  for (const entry of [
    changed(editablePath, 'M', 1, 0, { oldMode: '100644', newMode: '100755' }),
    changed(editablePath, 'T', 0, 0, { oldMode: '100644', newMode: '120000' }),
    changed(editablePath, 'M', 1, 0, { oldMode: '120000', newMode: '120000' }),
    changed(editablePath, 'M', 1, 0, { oldMode: '160000', newMode: '160000' }),
  ]) {
    assert.throws(
      () =>
        assessLegacyRetirement({
          entries: [...deletionEntries, entry],
          ...retirementContext(),
        }),
      /same-mode ordinary blob modification/,
    );
  }
});

test('retirement integration edits remain under tight non-deletion budgets', () => {
  assert.equal(
    assessLegacyRetirement({
      entries: [...deletionEntries, changed('pnpm-lock.yaml', 'M', 0, 2674)],
      ...retirementContext(),
    }).editableChangedLines,
    2674,
  );
  assert.equal(
    assessLegacyRetirement({
      entries: [...deletionEntries, changed('pnpm-lock.yaml', 'M', 0, 3000)],
      ...retirementContext(),
    }).editableChangedLines,
    3000,
  );
  assert.throws(
    () =>
      assessLegacyRetirement({
        entries: [
          ...deletionEntries,
          changed(
            legacyRetirementEditableFiles[0],
            'M',
            legacyRetirementLimits.maxEditableAdditions + 1,
          ),
        ],
        ...retirementContext(),
      }),
    /editable-addition budget exceeded/,
  );
  const tooMany = legacyRetirementEditableFiles
    .slice(0, legacyRetirementLimits.maxEditableFiles + 1)
    .map((path) => changed(path));
  assert.throws(
    () =>
      assessLegacyRetirement({
        entries: [...deletionEntries, ...tooMany],
        ...retirementContext(),
      }),
    /editable-file budget exceeded/,
  );
  const atChangedLineLimit = legacyRetirementEditableFiles
    .slice(0, 3)
    .map((path, index) => changed(path, 'M', 0, index === 0 ? 2500 : 3000));
  assert.equal(
    atChangedLineLimit.reduce((sum, entry) => sum + entry.changedLines, 0),
    8500,
  );
  assert.equal(
    assessLegacyRetirement({
      entries: [...deletionEntries, ...atChangedLineLimit],
      ...retirementContext(),
    }).editableChangedLines,
    8500,
  );
  const overChangedLineLimit = legacyRetirementEditableFiles
    .slice(0, 3)
    .map((path, index) => changed(path, 'M', 0, index === 0 ? 2501 : 3000));
  assert.equal(
    overChangedLineLimit.reduce((sum, entry) => sum + entry.changedLines, 0),
    8501,
  );
  assert.throws(
    () =>
      assessLegacyRetirement({
        entries: [...deletionEntries, ...overChangedLineLimit],
        ...retirementContext(),
      }),
    /editable changed-line budget exceeded/,
  );
  const overPerFileLimit = changed(
    legacyRetirementEditableFiles[0],
    'M',
    0,
    legacyRetirementLimits.maxChangedLinesPerEditableFile + 1,
  );
  assert.equal(overPerFileLimit.changedLines, 3001);
  assert.throws(
    () =>
      assessLegacyRetirement({
        entries: [...deletionEntries, overPerFileLimit],
        ...retirementContext(),
      }),
    /per-editable-file budget exceeded/,
  );
});

test('CONSUMED restores ordinary ceilings while deletion tombstones stay closed', () => {
  assert.equal(
    assessPullRequest(contract, [changed('apps/web/src/App.tsx', 'M')], {
      retirementState: 'CONSUMED',
    }).mode,
    'PRODUCT',
  );
  assert.throws(
    () =>
      assessPullRequest(contract, [changed('apps/web/src/App.tsx', 'M', 5001)], {
        retirementState: 'CONSUMED',
      }),
    /changed-line budget exceeded/,
  );
  assert.throws(
    () =>
      classifyLegacyRetirementState({
        expectedPaths: inventoryPaths,
        comparisonPaths: [],
        candidatePaths: ['apps/runtime/replayed.ts'],
      }),
    /partial, added, or drifted inventory/,
  );
  assert.equal(
    assessCumulative(contract, [changed('apps/web/src/App.tsx', 'M', 15000)]).changedLines,
    15000,
  );
});

test('status-aware parser binds name status to raw mode and object metadata', () => {
  const oldObject = 'a'.repeat(40);
  const raw = `:100644 000000 ${oldObject} ${zeroObject} D\0old.ts\0`;
  assert.deepEqual(parseStatusEntries('0\t3\told.ts\0', 'D\0old.ts\0', raw), [
    {
      path: 'old.ts',
      additions: 0,
      deletions: 3,
      changedLines: 3,
      status: 'D',
      oldMode: '100644',
      newMode: '000000',
      oldObject,
      newObject: zeroObject,
    },
  ]);
  assert.throws(
    () => parseStatusEntries('1\t0\tnew.ts\0', 'R100\0old.ts\0new.ts\0', ''),
    /malformed|unsupported/,
  );
  assert.throws(
    () =>
      parseStatusEntries(
        '-\t-\timage.bin\0',
        'D\0image.bin\0',
        `:100644 000000 ${oldObject} ${zeroObject} D\0image.bin\0`,
      ),
    /binary change is not allowed/,
  );
  assert.throws(
    () => parseStatusEntries('0\t3\told.ts\0', 'D\0old.ts\0', raw.replace(' D\0', ' M\0')),
    /status\/raw mismatch/,
  );
  assert.throws(
    () =>
      parseStatusEntries(
        '0\t3\told.ts\0',
        'D\0old.ts\0',
        raw.replace('old.ts\0', 'different.ts\0'),
      ),
    /status\/raw mismatch/,
  );
});

test('PR workflow has an isolated trusted base-side retirement gate', () => {
  const workflow = readFileSync(join(repo, '.github/workflows/pr-ci.yml'), 'utf8');
  const trustedStart = workflow.indexOf('  trusted-retirement-policy:');
  const qualityStart = workflow.indexOf('  quality:');
  const billingStart = workflow.indexOf('  billing-pg:');
  assert.ok(trustedStart > 0 && qualityStart > trustedStart && billingStart > qualityStart);
  const trustedJob = workflow.slice(trustedStart, qualityStart);
  const qualityJob = workflow.slice(qualityStart, billingStart);
  const billingJob = workflow.slice(billingStart);

  assert.equal(legacyRetirementEditableFiles.includes('.github/workflows/pr-ci.yml'), false);
  assert.ok(policyPaths.includes('.github/workflows/pr-ci.yml'));
  assert.match(workflow, /pull_request:\n {2}pull_request_target:\n/u);
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/u);
  assert.match(workflow, /permissions:\n {2}contents: read/u);
  assert.match(workflow, /group: pr-ci-\$\{\{ github\.event_name \}\}-/u);
  assert.match(trustedJob, /name: CI \/ trusted retirement policy/u);
  assert.match(trustedJob, /if: \$\{\{ github\.event_name == 'pull_request_target' \}\}/u);
  assert.match(trustedJob, /ref: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/u);
  assert.match(trustedJob, /fetch-depth: 0/u);
  assert.match(trustedJob, /persist-credentials: false/u);
  assert.match(trustedJob, /git rev-parse HEAD\^1\)" == "\$BASE_SHA"/u);
  assert.match(trustedJob, /git rev-parse HEAD\^2\)" == "\$HEAD_SHA"/u);
  assert.match(trustedJob, /git archive --format=tar "\$BASE_SHA" -- scripts/u);
  assert.match(trustedJob, /COMBO_BUDGET_REPO_ROOT="\$GITHUB_WORKSPACE"/u);
  assert.match(
    trustedJob,
    /node "\$RUNNER_TEMP\/combo-budget-base\/scripts\/vnext-rebaseline-budget\.mjs"/u,
  );
  assert.doesNotMatch(
    trustedJob,
    /\b(?:pnpm|npm|yarn|bun)\b|cache:|node scripts\/|secrets\.|permissions:/u,
  );
  assert.match(qualityJob, /if: \$\{\{ github\.event_name == 'pull_request' \}\}/u);
  assert.match(billingJob, /if: \$\{\{ github\.event_name == 'pull_request' \}\}/u);
  assert.match(workflow, /if: \$\{\{ hashFiles\('apps\/sandboxd\/go\.mod'\) != '' \}\}/u);
  assert.match(
    workflow,
    /if: \$\{\{ hashFiles\('infra\/k8s\/overlays\/sandbox-tools\/maintenance\/\*\.sh'\) != '' \}\}/u,
  );
  assert.match(workflow, /if: \$\{\{ hashFiles\('apps\/runtime\/package\.json'\) != '' \}\}/u);
});

test('trusted repo-root override accepts only an existing canonical absolute checkout', () => {
  assert.equal(resolveBudgetRepoRoot(), repo);
  assert.equal(resolveBudgetRepoRoot({ override: repo }), repo);
  assert.throws(
    () => resolveBudgetRepoRoot({ override: 'relative/checkout' }),
    /absolute normalized path/,
  );
  assert.throws(() => resolveBudgetRepoRoot({ override: `${repo}/.` }), /absolute normalized path/);
});

test('retirement manifest excludes preserved migrations and current product paths', () => {
  for (const path of [
    'db/migrations/0001_init.sql',
    'apps/billing/src/app.ts',
    'apps/creator-worker/src/index.ts',
    'apps/creator-worker/src/agent-package-receiver/contract.ts',
    'apps/creator-worker/src/agent-package-session.ts',
    'apps/creator-worker/src/authoring/project-context-compiler.ts',
    'apps/authoring/src/modules/agent-draft/routes.ts',
    'apps/authoring/src/modules/agent-package-release/publication-objects.ts',
    'apps/authoring/src/modules/agent-package-release/publication-service.ts',
    'apps/authoring/src/modules/agent-package-release/receiver-handoff.ts',
    'apps/authoring/src/modules/agent-package-release/transfer-contract.ts',
    'apps/authoring/src/modules/agent-package-release/transfer-routes.ts',
    'apps/authoring/src/modules/agent-package-release/transfer-service.ts',
    'apps/web/src/pages/LoginPage.tsx',
    'apps/web/src/pages/agents/AgentReleasePage.tsx',
    'apps/web/src/pages/landing/LandingPage.tsx',
    'infra/k8s/job-minio-init.yaml',
    'infra/minio/init-buckets.sh',
    'packages/creator-agent-broker-journal/src/index.ts',
    'packages/creator-agent-protocol/src/agent-context.ts',
    'packages/creator-agent-protocol/src/agent-package-draft.ts',
    'packages/creator-agent-protocol/src/agent-package-receiver.ts',
    'packages/creator-agent-protocol/src/agent-package-release.ts',
    'packages/creator-agent-protocol/src/agent-package.ts',
    'packages/creator-agent-protocol/src/canonical.ts',
    'packages/creator-agent-protocol/src/index.ts',
  ]) {
    assert.equal(isLegacyRetirementDeletionPath(path), false, path);
  }
});

test('retirement manifest classifies the corrected shared, web, and infrastructure exits', () => {
  for (const path of [
    'apps/web/src/test/fixtures.ts',
    'docs/diagrams/combo-upload-first-run.mmd',
    'infra/host/release/combo-test-s3-forward.service',
    'infra/k8s/redis-queue.yaml',
    'packages/shared/src/core/progress.ts',
    'packages/shared/src/core/sse.ts',
    'packages/shared/src/ports/llm-gateway.ts',
    'scripts/combo-dev-public-s3-smoke.py',
  ])
    assert.equal(isLegacyRetirementDeletionPath(path), true, path);

  for (const path of [
    'apps/authoring/src/platform/http/client-events.ts',
    'apps/web/src/api/sessionLogout.ts',
    'apps/web/src/pages/LoginPage.tsx',
    'infra/k8s/environments/shared-foundation/kustomization.yaml',
    'packages/shared/src/core/index.ts',
    'scripts/deploy-env.sh',
    'scripts/migrate-v2-host.sh',
    'tests/e2e/resend-auth.spec.ts',
  ]) {
    assert.equal(isLegacyRetirementDeletionPath(path), false, path);
    assert.ok(legacyRetirementEditableFiles.includes(path), path);
  }
  assert.equal(isLegacyRetirementDeletionPath('apps/web/src/design-claude.css'), false);
  assert.equal(legacyRetirementEditableFiles.includes('apps/web/src/design-claude.css'), false);
  assert.equal(isLegacyRetirementDeletionPath('db/migrations/0001_init.sql'), false);
});

test('follow-up classifies unused Web helpers, migration-only contracts, list support, and browser presign exposure for deletion', () => {
  assert.deepEqual(addedDeletionOnlyPaths, [...addedDeletionOnlyPaths].sort());
  for (const path of addedDeletionOnlyPaths) {
    assert.equal(isLegacyRetirementDeletionPath(path), true, path);
    assert.ok(legacyRetirementDeletionFiles.includes(path), path);
    assert.equal(legacyRetirementEditableFiles.includes(path), false, path);
  }
});

test('follow-up keeps exact consumers and current docs editable with zero deletion overlap', () => {
  assert.deepEqual(addedEditablePaths, [...addedEditablePaths].sort());
  for (const path of addedEditablePaths) {
    assert.equal(isLegacyRetirementDeletionPath(path), false, path);
    assert.equal(legacyRetirementDeletionFiles.includes(path), false, path);
    assert.ok(legacyRetirementEditableFiles.includes(path), path);
  }
  assert.deepEqual(legacyRetirementEditableFiles.filter(isLegacyRetirementDeletionPath), []);
});

test('final correction retires the generic legacy client test and keeps workspace build policy editable', () => {
  assert.equal(isLegacyRetirementDeletionPath('apps/web/src/api/client.test.ts'), true);
  assert.ok(legacyRetirementDeletionFiles.includes('apps/web/src/api/client.test.ts'));
  assert.equal(legacyRetirementEditableFiles.includes('apps/web/src/api/client.test.ts'), false);

  assert.equal(isLegacyRetirementDeletionPath('pnpm-workspace.yaml'), false);
  assert.equal(legacyRetirementDeletionFiles.includes('pnpm-workspace.yaml'), false);
  assert.ok(legacyRetirementEditableFiles.includes('pnpm-workspace.yaml'));
});

test('reviewed retirement paths have explicit deletion, editable, and excluded classifications', () => {
  for (const deletionOnlyPath of [
    'apps/authoring/src/__tests__/fakes.ts',
    'packages/shared/src/__tests__/knowledge.test.ts',
    'packages/shared/src/domains/knowledge.ts',
    'scripts/acceptance-smoke.sh',
  ]) {
    assert.equal(isLegacyRetirementDeletionPath(deletionOnlyPath), true, deletionOnlyPath);
    assert.ok(legacyRetirementDeletionFiles.includes(deletionOnlyPath), deletionOnlyPath);
    assert.equal(legacyRetirementEditableFiles.includes(deletionOnlyPath), false, deletionOnlyPath);
  }

  for (const editablePath of [
    'apps/authoring/src/__tests__/auth-session.test.ts',
    'apps/authoring/src/modules/billing/README.md',
    'apps/authoring/src/platform/http/fastify.ts',
    'apps/authoring/src/platform/infra/db.ts',
    'apps/authoring/src/platform/middleware/README.md',
    'apps/authoring/src/platform/middleware/auth.ts',
    'apps/authoring/src/platform/observability/node.ts',
    'apps/authoring/src/processes/api.ts',
    'apps/web/src/api/telemetry.ts',
    'infra/k8s/job-minio-init.yaml',
    'infra/minio/init-buckets.sh',
    'packages/shared/src/__tests__/pending-recovery.test.ts',
    'packages/shared/src/domains/pending-recovery.ts',
    'tests/e2e/README.md',
  ]) {
    assert.equal(isLegacyRetirementDeletionPath(editablePath), false, editablePath);
    assert.equal(legacyRetirementDeletionFiles.includes(editablePath), false, editablePath);
    assert.ok(legacyRetirementEditableFiles.includes(editablePath), editablePath);
  }

  const noCleanupPath = 'packages/shared/src/constants/index.ts';
  assert.equal(isLegacyRetirementDeletionPath(noCleanupPath), false);
  assert.equal(legacyRetirementDeletionFiles.includes(noCleanupPath), false);
  assert.equal(legacyRetirementEditableFiles.includes(noCleanupPath), false);
});
