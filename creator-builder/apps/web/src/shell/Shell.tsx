// 导航外壳 Shell（F-04，D14：左侧栏 + 顶栏面包屑，恒定结构）。
// 创作者 / 消费者双视角开关占位（本期只切前端态）。子页经 <Outlet> 渲染。
import type { ReactElement } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CREATOR_NAV, breadcrumbFor } from './routes.js';
import { useViewMode } from './viewMode.js';

export function Shell(): ReactElement {
  const location = useLocation();
  const { mode, toggle } = useViewMode();
  const crumbs = breadcrumbFor(location.pathname);

  return (
    <div className="cb-shell" data-view-mode={mode}>
      {/* 左侧栏：恒定主导航。 */}
      <aside className="cb-shell__sidebar">
        <div className="cb-shell__brand">
          <Link to="/creator">创作者中心</Link>
        </div>
        <nav className="cb-shell__nav" aria-label="主导航">
          <ul>
            {CREATOR_NAV.filter((n) => n.inSidebar).map((n) => (
              <li key={n.path}>
                <NavLink
                  to={n.path}
                  className={({ isActive }) =>
                    isActive ? 'cb-shell__navlink cb-shell__navlink--active' : 'cb-shell__navlink'
                  }
                  end={n.path === '/creator'}
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* 主区：顶栏面包屑 + 视角开关 + 内容 Outlet。 */}
      <div className="cb-shell__main">
        <header className="cb-shell__topbar">
          <nav className="cb-shell__breadcrumb" aria-label="面包屑">
            {crumbs.map((c, i) => (
              <span key={c.path} className="cb-shell__crumb">
                {i > 0 && <span className="cb-shell__crumb-sep"> / </span>}
                {i < crumbs.length - 1 ? (
                  <Link to={c.path}>{c.label}</Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          {/* 双视角开关占位（D14）：本期只切前端态，不动鉴权/路由。 */}
          <button
            type="button"
            className="cb-shell__viewtoggle"
            onClick={toggle}
            aria-pressed={mode === 'consumer'}
            title="切换创作者 / 消费者视角（占位）"
          >
            {mode === 'creator' ? '创作者视角' : '消费者视角'}
          </button>
        </header>

        <main className="cb-shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
