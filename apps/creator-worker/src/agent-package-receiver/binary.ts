import { main } from './cli.js';
import { ReceiverError } from './contract.js';

// This entry is bundled by the pinned build tool; importing the core has no task side effects.
const runtime = globalThis as typeof globalThis & { Bun?: { isStandaloneExecutable?: boolean } };
if (runtime.Bun?.isStandaloneExecutable) {
  await main(process.execPath);
} else {
  const error = new ReceiverError('UNSUPPORTED_RUNTIME');
  process.stdout.write(
    `${JSON.stringify({ protocol: 'combo.agent-package-receiver-error/1', status: 'error', code: error.code, message: error.message, runtime: { status: 'not_run' } })}\n`,
  );
  process.exitCode = 1;
}
