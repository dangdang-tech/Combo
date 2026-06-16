// 占位页集合（Phase 4 各自拆成独立文件 + 真实实现）。每页标注对接的后端契约端点。
//
// 五步上传向导壳 + STEP③ 已由 pages/wizard/ 实现（WizardLayout/WizardShell/SelectStepPage）：
//   /create 路由元素改用 WizardLayout（替代旧 CreateLayout 步骤条占位），STEP③ 用 wizard 的 SelectStepPage。
//   本文件保留 STEP①②④⑤ 占位页（后续模块填），它们渲染在 WizardShell 的 <Outlet> 内（外壳恒定 D14）。
import type { ReactElement } from 'react';
import { Placeholder } from './Placeholder.js';

// F-07 三页真实实现（我的能力 / 数据分析 / 收益）——各自独立文件 + 组件测试。
export { CapabilitiesPage } from './capabilities/CapabilitiesPage.js';
export { AnalyticsPage } from './analytics/AnalyticsPage.js';
export { RevenuePage } from './revenue/RevenuePage.js';

// F-06 个人主页真实实现（六分区主聚合）——独立目录 + 组件测试。
export { ProfilePage } from './profile/index.js';

// 公开能力页 /a/:slug（对外只读最小视图）——工作台「查看公开页」/ 作品墙卡片的落点。
export { PublicCapabilityPage } from './public/PublicCapabilityPage.js';

// F-10 STEP① 导入 + F-11 STEP② 提取 + F-13 STEP④ 结构化 + F-14 STEP⑤ 发布真实实现（接 3B/3C/3D/3E API+SSE，在 WizardShell 内）。
export {
  ImportStepPage,
  ExtractStepPage,
  StructureStepPage,
  PublishStepPage,
} from './upload/index.js';

export function WorkbenchPage(): ReactElement {
  return (
    <Placeholder
      title="工作台"
      hint="对接 GET /dashboard/summary · /metrics · /token-trend · /capabilities · /drafts"
    />
  );
}

export function NotFoundPage(): ReactElement {
  return <Placeholder title="未找到页面" hint="链接可能失效或页面尚未上线。" />;
}

// STEP①②④⑤ 由 pages/upload 实现（F-10/F-11/F-13/F-14，接 3B/3C/3D/3E API+SSE，在 WizardShell 内）。
// STEP③ 选择由 pages/wizard/SelectStepPage 实现（F-12，纯前端即时态 + 存草稿 PATCH /drafts/{id}/selection）。
