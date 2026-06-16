// 占位页集合（Phase 4 各自拆成独立文件 + 真实实现）。每页标注对接的后端契约端点。
import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { Placeholder } from './Placeholder.js';
import { CREATE_STEPS } from '../shell/routes.js';

// F-07 三页真实实现（我的能力 / 数据分析 / 收益）——各自独立文件 + 组件测试。
export { CapabilitiesPage } from './capabilities/CapabilitiesPage.js';
export { AnalyticsPage } from './analytics/AnalyticsPage.js';
export { RevenuePage } from './revenue/RevenuePage.js';

// F-06 个人主页真实实现（六分区主聚合）——独立目录 + 组件测试。
export { ProfilePage } from './profile/index.js';

// 公开能力页 /a/:slug（对外只读最小视图）——工作台「查看公开页」/ 作品墙卡片的落点。
export { PublicCapabilityPage } from './public/PublicCapabilityPage.js';

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

/** 上传五步布局：列出步骤导航 + 子页 Outlet（Phase 4 接 draft 续传断点）。 */
export function CreateLayout(): ReactElement {
  return (
    <div className="cb-create">
      <ol className="cb-create__steps">
        {CREATE_STEPS.map((s, i) => (
          <li key={s.step} className="cb-create__step">
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>
      <div className="cb-create__body">
        <Outlet />
      </div>
    </div>
  );
}

export function ImportStepPage(): ReactElement {
  return (
    <Placeholder
      title="STEP① 导入"
      hint="对接 POST /import/jobs · /import/connect/pair · GET /snapshots/{id}（job SSE）"
    />
  );
}

export function ExtractStepPage(): ReactElement {
  return (
    <Placeholder
      title="STEP② 提取"
      hint="对接 POST /snapshots/{id}/extract · GET /extract-jobs/{id}/candidates（job SSE）"
    />
  );
}

export function SelectStepPage(): ReactElement {
  return (
    <Placeholder title="STEP③ 选择" hint="纯前端即时态；存草稿 PATCH /drafts/{id}/selection" />
  );
}

export function StructureStepPage(): ReactElement {
  return (
    <Placeholder
      title="STEP④ 结构化"
      hint="对接 POST /versions/{id}/structure（structure SSE：字段流）· PATCH /manifest"
    />
  );
}

export function PublishStepPage(): ReactElement {
  return (
    <Placeholder
      title="STEP⑤ 发布"
      hint="对接 POST /versions/{id}/publish · /market-card/preview · /publish-batches"
    />
  );
}
