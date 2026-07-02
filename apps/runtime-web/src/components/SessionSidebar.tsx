import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RuntimeSessionListItem } from '@cb/shared';
import { useSessions } from '../api/runtime.js';

export function SessionSidebar({
  activeSession,
  activeSessionId,
  capabilitySlug,
}: {
  activeSession?: RuntimeSessionListItem;
  activeSessionId?: string;
  capabilitySlug?: string;
}) {
  const navigate = useNavigate();
  const sessions = useSessions(capabilitySlug);
  const visibleSessions = useMemo(() => {
    const items = (sessions.data?.items ?? []).filter(
      (item) => !capabilitySlug || item.slug === capabilitySlug,
    );
    if (!activeSession) return items;
    const exists = items.some((item) => item.id === activeSession.id);
    if (!exists) return [activeSession, ...items];
    return items.map((item) => (item.id === activeSession.id ? activeSession : item));
  }, [activeSession, capabilitySlug, sessions.data?.items]);

  return (
    <nav className="rt-sidebar">
      <div className="rt-sidebar__head">
        <div className="rt-sidebar__brand">Agora</div>
        <button type="button" className="rt-sidebar__inbox" onClick={() => navigate('/market')}>
          ← Inbox 返回收件箱
        </button>
      </div>
      <div className="rt-sidebar__label">正在运行</div>
      <div className="rt-sidebar__list">
        {visibleSessions.map((s) => (
          <SessionListLink key={s.id} session={s} active={s.id === activeSessionId} />
        ))}
        {sessions.data && visibleSessions.length === 0 && (
          <div className="rt-sidebar__empty">还没有会话</div>
        )}
      </div>
      <div className="rt-sidebar__user">
        <span className="rt-sidebar__user-avatar">W</span>
        <span>Wayne · CGO</span>
      </div>
    </nav>
  );
}

function SessionListLink({
  session,
  active,
}: {
  session: RuntimeSessionListItem;
  active: boolean;
}) {
  const title = session.capabilityName || session.title;
  const secondary = session.title && session.title !== title ? session.title : '';
  const avatar = title.trim().slice(0, 1).toUpperCase() || 'A';

  return (
    <Link to={`/session/${session.id}`} className={`rt-sidebar__item${active ? ' is-active' : ''}`}>
      <span className="rt-sidebar__avatar">{avatar}</span>
      <span className="rt-sidebar__item-copy">
        <span className="rt-sidebar__item-title">{title}</span>
        {secondary && <span className="rt-sidebar__item-cap">{secondary}</span>}
      </span>
      <span className="rt-sidebar__status" />
    </Link>
  );
}
