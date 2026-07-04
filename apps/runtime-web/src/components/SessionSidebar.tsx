// 左侧会话栏：历史会话列表（GET /runtime/sessions）+ 回创作端 / 回入口页。
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { SessionView } from '@cb/shared';
import { useSessions } from '../api/runtime.js';
import {
  runtimeBackLabel,
  runtimeBackTarget,
  safeRuntimeReturnTo,
} from '../navigation/runtimeReturn.js';

export function SessionSidebar({
  activeSessionId,
  returnTo,
}: {
  activeSessionId?: string;
  returnTo?: string | null;
}) {
  const safeReturnTo = safeRuntimeReturnTo(returnTo);
  const sessions = useSessions();
  const ordered = useMemo(
    () =>
      [...(sessions.data ?? [])].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [sessions.data],
  );

  return (
    <nav className="rt-sidebar">
      <div className="rt-sidebar__head">
        <div className="rt-sidebar__brand">Agora</div>
        <button
          type="button"
          className="rt-sidebar__inbox"
          onClick={() => window.location.assign(runtimeBackTarget(safeReturnTo))}
        >
          {runtimeBackLabel(safeReturnTo)}
        </button>
      </div>
      <div className="rt-sidebar__label">会话</div>
      <div className="rt-sidebar__list">
        <Link to="/market" className="rt-sidebar__item">
          <span className="rt-sidebar__avatar">＋</span>
          <span className="rt-sidebar__item-copy">
            <span className="rt-sidebar__item-title">新会话</span>
            <span className="rt-sidebar__item-cap">从能力列表开始</span>
          </span>
        </Link>
        {ordered.map((s) => (
          <SessionListLink key={s.id} session={s} active={s.id === activeSessionId} />
        ))}
        {sessions.data && ordered.length === 0 && (
          <div className="rt-sidebar__empty">还没有会话</div>
        )}
      </div>
    </nav>
  );
}

function SessionListLink({ session, active }: { session: SessionView; active: boolean }) {
  const title = session.title ?? '未命名会话';
  const avatar = title.trim().slice(0, 1).toUpperCase() || 'A';
  const updated = new Date(session.updatedAt).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Link to={`/session/${session.id}`} className={`rt-sidebar__item${active ? ' is-active' : ''}`}>
      <span className="rt-sidebar__avatar">{avatar}</span>
      <span className="rt-sidebar__item-copy">
        <span className="rt-sidebar__item-title">{title}</span>
        <span className="rt-sidebar__item-cap">
          {session.status === 'closed' ? '已结束 · ' : ''}
          {updated}
        </span>
      </span>
      <span className="rt-sidebar__status" />
    </Link>
  );
}
