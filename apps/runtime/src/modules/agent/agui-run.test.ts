import type { Pool } from 'pg';
import type { RuntimeArtifact } from '@cb/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactToolContext } from '../artifact/artifact-tool.js';
import type { SessionRow } from '../session/repo.js';
import type { AguiEmitter } from './agui-emitter.js';
import { DESIGN_STUDIO_REPAIR_PROMPT } from './design-studio-prompt.js';
import { runAgui } from './agui-run.js';

const mocks = vi.hoisted(() => ({
  buildAgent: vi.fn(),
  createArtifactTool: vi.fn(),
  hasLlmCredential: vi.fn(() => true),
  saveTurn: vi.fn(async () => undefined),
}));

vi.mock('./build-agent.js', () => ({ buildAgent: mocks.buildAgent }));
vi.mock('./model.js', () => ({ hasLlmCredential: mocks.hasLlmCredential }));
vi.mock('../session/repo.js', () => ({ saveTurn: mocks.saveTurn }));
vi.mock('../artifact/artifact-tool.js', () => ({
  createArtifactTool: mocks.createArtifactTool,
}));

const VALID_HTML = `<!doctype html><html><body>
  <label>目标 <input id="goal"></label>
  <button data-combo-key="run-primary">运行</button>
  <script>
    document.querySelector('[data-combo-key="run-primary"]').onclick = () => {
      const prompt = document.querySelector('#goal').value.trim();
      window.parent.postMessage({ type: 'combo:run', version: 1, prompt }, '*');
    };
  </script>
</body></html>`;

function makeEmitter(): AguiEmitter & Record<string, ReturnType<typeof vi.fn>> {
  const abort = new AbortController();
  return {
    runStarted: vi.fn(),
    textStart: vi.fn(),
    textContent: vi.fn(),
    textEnd: vi.fn(),
    stateDelta: vi.fn(),
    stateSnapshot: vi.fn(),
    runError: vi.fn(),
    runFinished: vi.fn(),
    flush: vi.fn(async () => undefined),
    end: vi.fn(),
    signal: abort.signal,
  };
}

function makeAgent(prompt: ReturnType<typeof vi.fn>) {
  return {
    prompt,
    abort: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    state: { messages: [] as unknown[], errorMessage: null as string | null },
  };
}

function makeInput(emitter: AguiEmitter, afterSave = vi.fn(async () => undefined)) {
  return {
    env: {} as never,
    pool: {} as Pool,
    session: {
      id: 'session-1',
      instructions: '能力边界',
      transcript: [],
    } as SessionRow,
    userText: '把主操作改得更清楚',
    intent: 'design' as const,
    emitter,
    afterSave,
    log: { error: vi.fn() },
  };
}

describe('runAgui Design Agent repair', () => {
  let artifactContext: ArtifactToolContext | null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasLlmCredential.mockReturnValue(true);
    mocks.saveTurn.mockResolvedValue(undefined);
    artifactContext = null;
    mocks.createArtifactTool.mockImplementation((context: ArtifactToolContext) => {
      artifactContext = context;
      return {} as never;
    });
  });

  it('retries a normal artifact-less design response once and saves the repaired main page', async () => {
    const prompt = vi.fn(async () => {
      if (prompt.mock.calls.length !== 2 || !artifactContext) return;
      artifactContext.collected.push({
        artifactKey: 'main',
        version: 1,
        kind: 'html',
        title: 'Miniapp',
      });
      artifactContext.onArtifact({
        artifactKey: 'main',
        latestVersion: 1,
        title: 'Miniapp',
        versions: [{ version: 1, kind: 'html', content: VALID_HTML }],
      } as RuntimeArtifact);
    });
    mocks.buildAgent.mockReturnValue(makeAgent(prompt));
    const emitter = makeEmitter();
    const afterSave = vi.fn(async () => undefined);

    await expect(runAgui(makeInput(emitter, afterSave))).resolves.toBe('completed');

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveBeenNthCalledWith(1, '把主操作改得更清楚');
    expect(prompt).toHaveBeenNthCalledWith(2, DESIGN_STUDIO_REPAIR_PROMPT);
    expect(mocks.saveTurn).toHaveBeenCalledTimes(1);
    expect(afterSave).toHaveBeenCalledWith(
      expect.objectContaining({
        artifacts: [expect.objectContaining({ artifactKey: 'main', kind: 'html' })],
      }),
    );
    expect(emitter.runFinished).toHaveBeenCalledTimes(1);
    expect(emitter.runError).not.toHaveBeenCalled();
  });

  it('stops after the single repair when no accepted page is produced', async () => {
    const prompt = vi.fn(async () => undefined);
    mocks.buildAgent.mockReturnValue(makeAgent(prompt));
    const emitter = makeEmitter();

    await expect(runAgui(makeInput(emitter))).resolves.toBe('failed');

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveBeenLastCalledWith(DESIGN_STUDIO_REPAIR_PROMPT);
    expect(mocks.saveTurn).not.toHaveBeenCalled();
    expect(emitter.runError).toHaveBeenCalledWith('页面暂时没有生成成功，请重试。');
  });

  it('does not repair a prompt exception', async () => {
    const prompt = vi.fn(async () => {
      throw new Error('provider unavailable');
    });
    mocks.buildAgent.mockReturnValue(makeAgent(prompt));
    const emitter = makeEmitter();

    await expect(runAgui(makeInput(emitter))).resolves.toBe('failed');

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(mocks.saveTurn).not.toHaveBeenCalled();
    expect(emitter.runError).toHaveBeenCalledWith('对话生成失败，请重试。');
  });

  it('does not repair a runtime error encoded in the assistant message', async () => {
    const prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: 'assistant', stopReason: 'error', errorMessage: 'quota exceeded' },
      ];
    });
    const agent = makeAgent(prompt);
    mocks.buildAgent.mockReturnValue(agent);
    const emitter = makeEmitter();

    await expect(runAgui(makeInput(emitter))).resolves.toBe('failed');

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(mocks.saveTurn).not.toHaveBeenCalled();
    expect(emitter.runError).toHaveBeenCalledWith('模型调用失败（额度/网络/服务波动），请重试。');
  });
});
