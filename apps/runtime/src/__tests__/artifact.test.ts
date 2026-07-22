// 产物工具 upsert：MinIO 键稳定（更新即覆写同一对象）/ 表行原地更新 / 幻觉 id 按新建处理。
import { describe, expect, it } from 'vitest';
import type { ArtifactView } from '@cb/shared';
import { createArtifactTool } from '../modules/artifact/tool.js';
import {
  ARTIFACT_BUCKET,
  artifactStorageKey,
  bindCapabilityUiArtifact,
  seedCapabilityUiArtifact,
} from '../modules/artifact/repo.js';
import { StudioArtifactValidationError } from '../modules/artifact/studio-contract.js';
import { createSession, getOrCreateStudioSession } from '../modules/session/repo.js';
import { FakeDb, FakeObjectStore } from './fakes.js';

const SESSION = 'sess-000001';

function setup() {
  const db = new FakeDb();
  const store = new FakeObjectStore();
  const emitted: ArtifactView[] = [];
  const tool = createArtifactTool({
    db,
    objectStore: store,
    sessionId: SESSION,
    onArtifact: (a) => emitted.push(a),
  });
  return { db, store, emitted, tool };
}

function studioHtml(label: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>button{color:red}</style></head>
<body><input id="goal"><button data-combo-key="run-primary">${label}</button>
<script>
document.querySelector('[data-combo-key="run-primary"]').addEventListener('click', () => {
  const prompt = document.querySelector('#goal').value.trim();
  window.parent.postMessage({ type: 'combo:run', version: 1, prompt }, '*');
});
</script></body></html>`;
}

describe('upsert_artifact 工具', () => {
  it('新建：写 MinIO + 插表行 + 回调产物视图，回执带 artifactId', async () => {
    const { db, store, emitted, tool } = setup();
    const result = await tool.execute('tc-1', {
      kind: 'html',
      title: '周报页面',
      content: '<!doctype html><html>v1</html>',
    });

    const id = result.details!.artifactId;
    expect(id).toBeTruthy();
    // MinIO 键按 (session, artifact) 稳定。
    const key = artifactStorageKey(SESSION, id);
    expect(await store.getObjectText(ARTIFACT_BUCKET as never, key)).toContain('v1');
    // 表行。
    const row = db.artifacts.get(id);
    expect(row?.kind).toBe('html');
    expect(row?.title).toBe('周报页面');
    expect(row?.storage_key).toBe(key);
    // 产物更新回调（run-turn 据此发 AG-UI 事件）。
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.id).toBe(id);
  });

  it('更新：同 artifactId → 同一 MinIO 键覆写内容，表行原地更新（无新行）', async () => {
    const { db, store, tool } = setup();
    const first = await tool.execute('tc-1', {
      kind: 'html',
      title: '周报页面',
      content: '<!doctype html><html>v1</html>',
    });
    const id = first.details!.artifactId;

    const second = await tool.execute('tc-2', {
      artifactId: id,
      kind: 'html',
      title: '周报页面（改）',
      content: '<!doctype html><html>v2</html>',
    });
    expect(second.details!.artifactId).toBe(id); // id 稳定
    expect(db.artifacts.size).toBe(1); // 无版本、无新行
    expect(db.artifacts.get(id)?.title).toBe('周报页面（改）');

    const key = artifactStorageKey(SESSION, id);
    expect(await store.getObjectText(ARTIFACT_BUCKET as never, key)).toContain('v2'); // 原地覆盖
  });

  it('幻觉/跨会话 artifactId → 按新建处理（不覆盖别人的对象）', async () => {
    const { db, tool } = setup();
    const result = await tool.execute('tc-1', {
      artifactId: 'made-up-id',
      kind: 'markdown',
      title: '笔记',
      content: '# hi',
    });
    expect(result.details!.artifactId).not.toBe('made-up-id');
    expect(db.artifacts.has('made-up-id')).toBe(false);
    expect(db.artifacts.size).toBe(1);
  });

  it('Studio 每次写不可变 revision，tool 本身不提前提升 capability 当前 UI', async () => {
    const db = new FakeDb();
    const store = new FakeObjectStore();
    const cap = db.seedCapability({ owner_user_id: 'creator' });
    const studio = await getOrCreateStudioSession(db, {
      capabilityId: cap.id,
      ownerUserId: cap.owner_user_id,
    });
    const emitted: ArtifactView[] = [];
    const tool = createArtifactTool({
      db,
      objectStore: store,
      sessionId: studio.id,
      capabilityId: cap.id,
      mode: 'studio',
      onArtifact: (artifact) => emitted.push(artifact),
    });

    const first = await tool.execute('studio-1', {
      kind: 'html',
      title: 'Agent UI',
      content: studioHtml('运行 v1'),
    });
    const firstId = first.details!.artifactId;
    expect(db.capabilities.get(cap.id)?.ui_artifact_id).toBeNull();

    const second = await tool.execute('studio-2', {
      artifactId: firstId,
      kind: 'html',
      title: 'Agent UI v2',
      content: studioHtml('运行 v2'),
    });
    const secondId = second.details!.artifactId;
    expect(secondId).not.toBe(firstId);
    expect(db.artifacts.size).toBe(2);
    expect(db.capabilities.get(cap.id)?.ui_artifact_id).toBeNull();
    expect(emitted).toHaveLength(2);
    expect(
      await store.getObjectText(ARTIFACT_BUCKET as never, artifactStorageKey(studio.id, firstId)),
    ).toContain('运行 v1');
    expect(
      await store.getObjectText(ARTIFACT_BUCKET as never, artifactStorageKey(studio.id, secondId)),
    ).toContain('运行 v2');
  });

  it('Studio 拒绝不完整、缺 bridge 或伪造运行的 HTML，且不写 DB/ObjectStore', async () => {
    const db = new FakeDb();
    const store = new FakeObjectStore();
    const cap = db.seedCapability({ owner_user_id: 'creator' });
    const studio = await getOrCreateStudioSession(db, {
      capabilityId: cap.id,
      ownerUserId: cap.owner_user_id,
    });
    const tool = createArtifactTool({
      db,
      objectStore: store,
      sessionId: studio.id,
      capabilityId: cap.id,
      mode: 'studio',
      onArtifact: () => undefined,
    });

    await expect(
      tool.execute('studio-not-html', {
        kind: 'markdown',
        title: '不是页面',
        content: '# 说明',
      }),
    ).rejects.toBeInstanceOf(StudioArtifactValidationError);

    for (const content of [
      '<html><body>只是片段</body></html>',
      studioHtml('运行').replace("type: 'combo:run'", "type: 'local:run'"),
      studioHtml('运行').replace(
        "window.parent.postMessage({ type: 'combo:run', version: 1, prompt }, '*');",
        "setTimeout(() => window.parent.postMessage({ type: 'combo:run', version: 1, prompt }, '*'), 500);",
      ),
      studioHtml('运行').replace(
        "const prompt = document.querySelector('#goal').value.trim();",
        "const mockResult = '完成'; const prompt = document.querySelector('#goal').value.trim();",
      ),
    ]) {
      await expect(
        tool.execute('studio-invalid', { kind: 'html', title: '坏页面', content }),
      ).rejects.toBeInstanceOf(StudioArtifactValidationError);
    }
    expect(db.artifacts.size).toBe(0);
    expect(db.capabilities.get(cap.id)?.ui_artifact_id).toBeNull();
    expect(store.objects.size).toBe(0);
  });
});

describe('capability 当前 UI 会话快照', () => {
  it('新 consume 拿创建时 UI；Studio 更新后新会话拿新版，旧会话保持不变', async () => {
    const db = new FakeDb();
    const store = new FakeObjectStore();
    const cap = db.seedCapability({ owner_user_id: 'creator', published: true });
    const studio = await getOrCreateStudioSession(db, {
      capabilityId: cap.id,
      ownerUserId: cap.owner_user_id,
    });
    const tool = createArtifactTool({
      db,
      objectStore: store,
      sessionId: studio.id,
      capabilityId: cap.id,
      mode: 'studio',
      onArtifact: () => undefined,
    });
    const first = await tool.execute('studio-v1', {
      kind: 'html',
      title: 'Agent UI',
      content: studioHtml('版本一'),
    });
    await bindCapabilityUiArtifact(db, {
      capabilityId: cap.id,
      artifactId: first.details!.artifactId,
      studioSessionId: studio.id,
    });

    const oldSession = await createSession(db, {
      capabilityId: cap.id,
      ownerUserId: 'consumer-a',
    });
    const oldView = await seedCapabilityUiArtifact(db, store, {
      capabilityId: cap.id,
      targetSessionId: oldSession.id,
    });
    const oldKey = artifactStorageKey(oldSession.id, oldView!.id);
    expect(await store.getObjectText(ARTIFACT_BUCKET as never, oldKey)).toContain('版本一');

    const second = await tool.execute('studio-v2', {
      kind: 'html',
      title: 'Agent UI',
      content: studioHtml('版本二'),
    });
    await bindCapabilityUiArtifact(db, {
      capabilityId: cap.id,
      artifactId: second.details!.artifactId,
      studioSessionId: studio.id,
    });
    const newSession = await createSession(db, {
      capabilityId: cap.id,
      ownerUserId: 'consumer-b',
    });
    const newView = await seedCapabilityUiArtifact(db, store, {
      capabilityId: cap.id,
      targetSessionId: newSession.id,
    });
    const newKey = artifactStorageKey(newSession.id, newView!.id);

    expect(await store.getObjectText(ARTIFACT_BUCKET as never, newKey)).toContain('版本二');
    expect(await store.getObjectText(ARTIFACT_BUCKET as never, oldKey)).toContain('版本一');
  });

  it('capability 尚无 UI 时保持旧兼容路径，不创建空 artifact', async () => {
    const db = new FakeDb();
    const store = new FakeObjectStore();
    const cap = db.seedCapability({ owner_user_id: 'creator' });
    const session = await createSession(db, {
      capabilityId: cap.id,
      ownerUserId: 'creator',
    });

    await expect(
      seedCapabilityUiArtifact(db, store, {
        capabilityId: cap.id,
        targetSessionId: session.id,
      }),
    ).resolves.toBeNull();
    expect(db.artifacts.size).toBe(0);
  });
});
