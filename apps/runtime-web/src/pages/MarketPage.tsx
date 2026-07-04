// 入口页：能力列表（我的 + 已发布）+ 历史会话。点能力 → 建会话进对话页。
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import {
  useCapabilities,
  useCreateSession,
  useSessions,
  type TrialCapability,
} from '../api/runtime.js';
import { QueryErrorNotice } from '../components/QueryErrorNotice.js';

const KIND_LABEL: Record<string, string> = {
  html: '网页',
  markdown: '文档',
  code: '代码',
  structured: '结构化',
};

export function MarketPage() {
  const navigate = useNavigate();
  const caps = useCapabilities();
  const sessions = useSessions();
  const createSession = useCreateSession();
  const [errorById, setErrorById] = useState<{ id: string; message: string } | null>(null);

  const enter = (capability: TrialCapability) => {
    if (createSession.isPending) return;
    setErrorById(null);
    createSession.mutate(capability.id, {
      onSuccess: (session) => navigate(`/session/${session.id}`),
      onError: (err) =>
        setErrorById({
          id: capability.id,
          message: err instanceof ApiError ? err.userMessage : '无法开始会话，请稍后重试。',
        }),
    });
  };

  const mine = caps.data?.filter((c) => c.owned) ?? [];
  const published = caps.data?.filter((c) => !c.owned) ?? [];

  return (
    <div className="rt-market">
      <section className="rt-market__hero">
        <h1 className="rt-market__title">挑一个能力，直接开聊</h1>
        <p className="rt-market__lede">
          每个能力都从一次真实会话里长出来。选一个，像和它对话一样把活干完——产物会实时生成在右侧。
        </p>
      </section>

      {sessions.data && sessions.data.length > 0 && (
        <section className="rt-market__section">
          <h2 className="rt-market__section-title">继续之前的会话</h2>
          <div className="rt-session-chips">
            {sessions.data.slice(0, 8).map((s) => (
              <Link key={s.id} to={`/session/${s.id}`} className="rt-session-chip">
                <span className="rt-session-chip__title">{s.title ?? '未命名会话'}</span>
                <span className="rt-session-chip__cap">
                  {new Date(s.updatedAt).toLocaleString('zh-CN')}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {caps.isPending && <div className="rt-empty">加载中…</div>}
      {caps.isError && <QueryErrorNotice error={caps.error} onRetry={() => void caps.refetch()} />}
      {caps.data && caps.data.length === 0 && (
        <div className="rt-empty">还没有可试用的能力。先在创作者中心提取一个吧。</div>
      )}

      {mine.length > 0 && (
        <CapabilitySection
          title="我的能力"
          items={mine}
          pending={createSession.isPending}
          errorById={errorById}
          onEnter={enter}
        />
      )}
      {published.length > 0 && (
        <CapabilitySection
          title="已发布的能力"
          items={published}
          pending={createSession.isPending}
          errorById={errorById}
          onEnter={enter}
        />
      )}
    </div>
  );
}

function CapabilitySection({
  title,
  items,
  pending,
  errorById,
  onEnter,
}: {
  title: string;
  items: TrialCapability[];
  pending: boolean;
  errorById: { id: string; message: string } | null;
  onEnter: (capability: TrialCapability) => void;
}) {
  return (
    <section className="rt-market__section">
      <h2 className="rt-market__section-title">{title}</h2>
      <div className="rt-card-grid">
        {items.map((c) => (
          <article key={c.id} className="rt-card">
            <div className="rt-card__type">{KIND_LABEL[c.kind] ?? c.kind}</div>
            <h3 className="rt-card__name">{c.name}</h3>
            <p className="rt-card__tagline">{c.summary}</p>
            <div className="rt-card__meta">
              <span className="rt-card__byline">{c.owned ? '我创作的' : '来自市集'}</span>
              <span>{c.published ? '已发布' : '未发布'}</span>
            </div>
            <div className="rt-card__foot">
              <button
                type="button"
                className="rt-btn rt-btn--accent"
                disabled={pending}
                onClick={() => onEnter(c)}
              >
                {pending ? '创建中…' : '开始会话'}
              </button>
            </div>
            {errorById?.id === c.id && <div className="rt-card__error">{errorById.message}</div>}
          </article>
        ))}
      </div>
    </section>
  );
}
