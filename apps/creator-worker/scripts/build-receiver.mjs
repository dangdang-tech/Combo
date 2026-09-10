import process from 'node:process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  MAX_RECEIVER_ARTIFACT_BYTES,
  RECEIVER_BUN_VERSION,
  RECEIVER_TARGETS,
  RECEIVER_VERSION,
  ReceiverManifestSchema,
} from '@cb/creator-agent-protocol/agent-package-receiver';

const environment = { ...process.env };
for (const name of ['BUN_BE_BUN', 'BUN_OPTIONS', 'NODE_OPTIONS']) delete environment[name];
environment.BUN_INSTALL_CACHE_DIR ??= resolve('node_modules/.cache/bun');
const version = spawnSync('bun', ['--version'], { encoding: 'utf8', env: environment });
if (version.status !== 0 || version.stdout.trim() !== RECEIVER_BUN_VERSION)
  throw new Error(`Receiver build requires the pinned Bun ${RECEIVER_BUN_VERSION} dev dependency.`);
const destination = resolve('dist/agent-package-receivers');
mkdirSync(destination, { recursive: true });
const artifacts = [];
for (const target of RECEIVER_TARGETS) {
  const output = resolve(destination, `${target}.pending`);
  const result = spawnSync(
    'bun',
    [
      'build',
      'dist/agent-package-receiver/binary.js',
      '--compile',
      `--target=bun-${target}`,
      '--no-compile-autoload-dotenv',
      '--no-compile-autoload-bunfig',
      '--no-compile-autoload-tsconfig',
      '--no-compile-autoload-package-json',
      '--env=disable',
      '--outfile',
      output,
    ],
    { env: environment, stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error(`Receiver build failed for ${target}.`);
  const byteLength = statSync(output).size;
  if (byteLength < 1 || byteLength > MAX_RECEIVER_ARTIFACT_BYTES)
    throw new Error(`Receiver artifact exceeds the bounded size for ${target}.`);
  const digest = `sha256:${createHash('sha256').update(readFileSync(output)).digest('hex')}`;
  const filename = `${target}-${digest.slice(7)}.bin`;
  renameSync(output, resolve(destination, filename));
  artifacts.push({ target, filename, digest, byteLength });
}
const manifest = ReceiverManifestSchema.parse({
  protocol: 'combo.agent-package-receiver-artifacts/2',
  receiverVersion: RECEIVER_VERSION,
  bunVersion: RECEIVER_BUN_VERSION,
  artifacts,
});
writeFileSync(resolve(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
