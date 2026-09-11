// 对外裸壳 PublicLayout——公开/404 页用：无创作者外壳（侧栏 / 账号 / 视角开关一律不出现）。
//
// Landing、公开 Agent、Agent 转移、登录与 404 都渲染在这里，只保留公开品牌导航。
import type { ReactElement } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ComboMark, ComboWordmark } from './brand.js';
import { sanitizeAuthReturnTo } from '@cb/shared';

export function PublicLayout(): ReactElement {
  const { pathname, search } = useLocation();
  const transferLogin =
    pathname === '/login' &&
    sanitizeAuthReturnTo(new URLSearchParams(search).get('returnTo') ?? '').startsWith(
      '/agent-transfers/',
    );
  const agentSurface =
    transferLogin ||
    pathname === '/' ||
    pathname.startsWith('/agents/') ||
    pathname.startsWith('/agent-transfers/');
  const shellClass = agentSurface ? 'cb-public-shell cb-public-shell--agent' : 'cb-public-shell';

  return (
    <div className={shellClass}>
      <header className="cb-public-shell__top">
        <Link to="/" className="cb-public-shell__brand" aria-label="Combo 首页">
          <ComboMark className="cb-public-shell__brand-mark" />
          <ComboWordmark className="cb-public-shell__brand-word" />
        </Link>
      </header>
      <main className="cb-public-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
