import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Role, RuntimeSessionListItem } from '@cb/shared';
import { useSessions } from '../api/runtime.js';
import { ComboWordmark } from './ComboBrand.js';
import { useRuntimeMe } from '../shell/AuthGate.js';

const ROLE_LABEL: Record<Role, string> = {
  creator: '创作者',
  consumer: '消费者',
  reviewer: '评审',
};

function modeLabel(mode: RuntimeSessionListItem['mode']): string {
  return mode === 'consume' ? '正式' : '试用';
}

function avatarInitial(name: string): string {
  const ch = Array.from(name.trim())[0] ?? '?';
  return ch.toUpperCase();
}

function safeReturnTarget(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/create/capabilities';
}

function sortLinkedSessions(items: RuntimeSessionListItem[]): RuntimeSessionListItem[] {
  return [...items].sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === 'consume' ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function SessionSidebar({
  activeSession,
  activeSessionId,
  capabilitySlug,
}: {
  activeSession?: RuntimeSessionListItem;
  activeSessionId?: string;
  capabilitySlug?: string;
}) {
  const [searchParams] = useSearchParams();
  const me = useRuntimeMe();
  const sessions = useSessions(capabilitySlug);
  const accountName = me?.account ?? '当前账号';
  const role = me?.roles[0];
  const accountTitle = role ? ROLE_LABEL[role] : '创作者';
  const returnTarget = safeReturnTarget(searchParams.get('returnTo'));
  const visibleSessions = useMemo(() => {
    const items = (sessions.data?.items ?? []).filter(
      (item) => !capabilitySlug || item.slug === capabilitySlug,
    );
    if (!activeSession) return sortLinkedSessions(items);
    const exists = items.some((item) => item.id === activeSession.id);
    if (!exists) return sortLinkedSessions([activeSession, ...items]);
    return sortLinkedSessions(
      items.map((item) => (item.id === activeSession.id ? activeSession : item)),
    );
  }, [activeSession, capabilitySlug, sessions.data?.items]);

  return (
    <nav className="rt-sidebar">
      <div className="rt-sidebar__head">
        <a href="/creator" className="rt-sidebar__brand" aria-label="Combo 创作者中心 首页">
          <ComboWordmark className="rt-sidebar__brand-word" />
        </a>
        <button
          type="button"
          className="rt-sidebar__back"
          aria-label="返回发布流程"
          title="返回发布流程"
          onClick={() => window.location.assign(returnTarget)}
        >
          <span aria-hidden="true">←</span>
        </button>
      </div>
      <div className="rt-sidebar__label">会话</div>
      <div className="rt-sidebar__list">
        {visibleSessions.map((s) => (
          <SessionListLink key={s.id} session={s} active={s.id === activeSessionId} />
        ))}
        {sessions.data && visibleSessions.length === 0 && (
          <div className="rt-sidebar__empty">还没有会话</div>
        )}
      </div>
      <div className="rt-sidebar__user">
        <span className="rt-sidebar__user-avatar" aria-hidden="true">
          {avatarInitial(accountName)}
        </span>
        <span>
          {accountName} · {accountTitle}
        </span>
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
        <span className="rt-sidebar__item-cap">
          <span className={`rt-sidebar__mode rt-sidebar__mode--${session.mode}`}>
            {modeLabel(session.mode)}
          </span>
          {secondary || '当前能力会话'}
        </span>
      </span>
      <span className="rt-sidebar__status" />
    </Link>
  );
}
