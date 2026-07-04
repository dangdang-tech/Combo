// 导航外壳 Shell：左侧固定侧栏 + 顶栏 + 主内容区，全流程恒定结构。
//
// 侧栏：顶部品牌字标 + 收起/展开开关；中段两项导航（任务 / 能力）；底部当前账号常驻区。
// 顶栏：居中字标（AGORA · CREATOR · 当前页）+ 右上账号头像。子页经 <Outlet> 渲染。
import type { ReactElement } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CREATOR_NAV, pageTitleFor, type NavItem } from './routes.js';
import { useCollapse } from './useCollapse.js';
import { useAccount, avatarInitial, type ShellAccount } from './account.js';
import { IconChevrons } from './icons.js';

export function Shell(): ReactElement {
  const location = useLocation();
  const { collapsed, toggle: toggleCollapse } = useCollapse();
  const account = useAccount();
  const pageTitle = pageTitleFor(location.pathname);

  return (
    <div className="cb-shell" data-collapsed={collapsed ? 'true' : 'false'}>
      {/* 左侧栏：恒定结构。收起时整体收窄为纯图标态。 */}
      <aside className="cb-shell__sidebar" aria-label="侧边导航">
        <div className="cb-shell__brand">
          <Link to="/tasks" className="cb-shell__brand-link" aria-label="Agora 创作者中心 首页">
            <span className="cb-shell__brand-mark" aria-hidden="true">
              A
            </span>
            <span className="cb-shell__brand-word">Agora</span>
          </Link>
          <button
            type="button"
            className="cb-shell__collapse"
            onClick={toggleCollapse}
            aria-pressed={collapsed}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <IconChevrons
              className="cb-shell__collapse-icon"
              style={collapsed ? { transform: 'rotate(180deg)' } : undefined}
            />
          </button>
        </div>

        <nav className="cb-shell__nav" aria-label="主导航">
          <ul className="cb-shell__navlist">
            {CREATOR_NAV.map((n) => (
              <NavItemLink key={n.path} item={n} collapsed={collapsed} />
            ))}
          </ul>
        </nav>

        {/* 侧栏底部：当前账号常驻区（头像 + 姓名 · 角色）。 */}
        <div className="cb-shell__account">
          <AccountAvatar account={account} className="cb-shell__account-avatar" />
          <span className="cb-shell__account-meta">
            <span className="cb-shell__account-name">{account.name}</span>
            <span className="cb-shell__account-title">{account.title}</span>
          </span>
        </div>
      </aside>

      {/* 主区：顶栏字标 + 右上头像 + 内容 Outlet。 */}
      <div className="cb-shell__main">
        <header className="cb-shell__topbar">
          <span className="cb-shell__topbar-spacer" aria-hidden="true" />
          <p className="cb-shell__eyebrow" aria-label={`当前页面：${pageTitle}`}>
            {`AGORA · CREATOR · ${pageTitle}`}
          </p>
          <AccountAvatar account={account} className="cb-shell__topbar-avatar" />
        </header>

        <main className="cb-shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** 单条侧栏导航项：展开显图标+文字；收起仅图标，文字降级为 title tooltip。 */
function NavItemLink({ item, collapsed }: { item: NavItem; collapsed: boolean }): ReactElement {
  const Icon = item.icon;
  return (
    <li>
      <NavLink
        to={item.path}
        className={({ isActive }) =>
          isActive ? 'cb-shell__navlink cb-shell__navlink--active' : 'cb-shell__navlink'
        }
        title={collapsed ? item.label : undefined}
      >
        <Icon className="cb-shell__navicon" />
        <span className="cb-shell__navlabel">{item.label}</span>
      </NavLink>
    </li>
  );
}

/** 账号头像：有 URL 用图，缺省走首字母兜底（非破图）。 */
function AccountAvatar({
  account,
  className,
}: {
  account: ShellAccount;
  className?: string;
}): ReactElement {
  const cls = className ? `cb-avatar ${className}` : 'cb-avatar';
  const alt = `${account.name} · ${account.title}`;
  if (account.avatarUrl) {
    return <img className={cls} src={account.avatarUrl} alt={alt} />;
  }
  return (
    <span className={cls} role="img" aria-label={alt}>
      {avatarInitial(account.name)}
    </span>
  );
}
