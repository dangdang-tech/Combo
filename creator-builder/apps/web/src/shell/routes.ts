// 路由 / 导航单一真源（D14：恒定结构）。Shell 侧栏、面包屑、<Routes> 都读这里，不各写一套。
//
// 五步上传流程映射 DraftStep（脊柱 §8.2：import/extract/select/structure/publish）。
// 路由占位页留待 Phase 4 实现（此处只搭外壳骨架）。
import type { DraftStep } from '@cb/shared';

export interface NavItem {
  /** 路由 path（react-router）。 */
  path: string;
  /** 侧栏 / 面包屑展示名（人话）。 */
  label: string;
  /** 是否进侧栏主导航（false = 仅路由，不上侧栏，如五步子页）。 */
  inSidebar: boolean;
}

/** 创作者侧栏主导航（恒定结构）。 */
export const CREATOR_NAV: NavItem[] = [
  { path: '/creator', label: '工作台', inSidebar: true },
  { path: '/capabilities', label: '我的能力', inSidebar: true },
  { path: '/create', label: '上传五步', inSidebar: true },
  { path: '/analytics', label: '数据分析', inSidebar: true },
  { path: '/earnings', label: '收益', inSidebar: true },
  { path: '/profile', label: '个人主页', inSidebar: true },
];

/** 上传五步子路由（映射 DraftStep；select 为纯前端步，脊柱 §8.2）。 */
export const CREATE_STEPS: { step: DraftStep; path: string; label: string }[] = [
  { step: 'import', path: '/create/import', label: 'STEP① 导入' },
  { step: 'extract', path: '/create/extract', label: 'STEP② 提取' },
  { step: 'select', path: '/create/select', label: 'STEP③ 选择' },
  { step: 'structure', path: '/create/structure', label: 'STEP④ 结构化' },
  { step: 'publish', path: '/create/publish', label: 'STEP⑤ 发布' },
];

/** 面包屑：把当前 pathname 拆成可点段（首页 → 区段 → 子页）。 */
export function breadcrumbFor(pathname: string): { path: string; label: string }[] {
  const all: { path: string; label: string }[] = [
    ...CREATOR_NAV.map((n) => ({ path: n.path, label: n.label })),
    ...CREATE_STEPS.map((s) => ({ path: s.path, label: s.label })),
  ];
  const crumbs: { path: string; label: string }[] = [{ path: '/creator', label: '首页' }];
  // 最长前缀匹配，逐段累积。
  const matched = all
    .filter(
      (n) =>
        pathname === n.path || pathname.startsWith(n.path + '/') || pathname.startsWith(n.path),
    )
    .sort((a, b) => a.path.length - b.path.length);
  for (const m of matched) {
    if (!crumbs.some((c) => c.path === m.path)) crumbs.push(m);
  }
  return crumbs;
}
