// 创作者中心前端外壳（F-04）：Shell（侧栏 + 面包屑 + 双视角开关）+ 全路由树。
// 路由占位页留待 Phase 4 填真实实现；本期只保证恒定外壳结构 + 路由可达。
import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './shell/Shell.js';
import { ViewModeProvider } from './shell/viewMode.js';
import { AccountProvider } from './shell/account.js';
import { DashboardPage } from './pages/dashboard/index.js';
import {
  CapabilitiesPage,
  AnalyticsPage,
  RevenuePage,
  ProfilePage,
  PublicCapabilityPage,
  NotFoundPage,
  CreateLayout,
  ImportStepPage,
  ExtractStepPage,
  SelectStepPage,
  StructureStepPage,
  PublishStepPage,
} from './pages/index.js';

export function App(): ReactElement {
  return (
    <ViewModeProvider>
      <AccountProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Navigate to="/creator" replace />} />
              <Route path="/creator" element={<DashboardPage />} />
              <Route path="/capabilities" element={<CapabilitiesPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/earnings" element={<RevenuePage />} />
              <Route path="/profile" element={<ProfilePage />} />
              {/* 公开只读个人主页（访客同视图）：/creators/:creatorId/profile（60 §2）。 */}
              <Route path="/creators/:creatorId/profile" element={<ProfilePage />} />
              {/* 公开能力页（对外只读最小视图）：工作台「查看公开页」/ 作品墙卡片落点 /a/:slug。 */}
              <Route path="/a/:slug" element={<PublicCapabilityPage />} />

              {/* 上传五步：父布局 + 五子步（映射 DraftStep）。 */}
              <Route path="/create" element={<CreateLayout />}>
                <Route index element={<Navigate to="/create/import" replace />} />
                <Route path="import" element={<ImportStepPage />} />
                <Route path="extract" element={<ExtractStepPage />} />
                <Route path="select" element={<SelectStepPage />} />
                <Route path="structure" element={<StructureStepPage />} />
                <Route path="publish" element={<PublishStepPage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AccountProvider>
    </ViewModeProvider>
  );
}
