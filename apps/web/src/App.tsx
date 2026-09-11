// 当前前端路由树：Landing、公开 Agent、受保护 Agent 转移、登录与 404。
import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './shell/auth.js';
import { PublicLayout } from './shell/PublicLayout.js';
import { LoginPage, NotFoundPage } from './pages/index.js';
import { LandingPage } from './pages/landing/LandingPage.js';
import { ReleaseIdentityBadge } from './shell/releaseIdentity.js';
import { AgentTransferPage } from './pages/agents/AgentTransferPage.js';
import { AgentReleasePage } from './pages/agents/AgentReleasePage.js';

/** 受保护组根：AuthProvider 只包受保护子树，公开页匿名访问根本不发 /me。 */
function ProtectedRoot(): ReactElement {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export function App(): ReactElement {
  return (
    <BrowserRouter>
      <ReleaseIdentityBadge />
      <Routes>
        <Route element={<ProtectedRoot />}>
          <Route element={<RequireAuth />}>
            <Route element={<PublicLayout />}>
              <Route path="/agent-transfers/:transferId" element={<AgentTransferPage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<PublicLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="/agents/:releaseId" element={<AgentReleasePage />} />
          {/* 登录页：两步邮箱验证码表单，只接受共享契约允许的站内 returnTo。 */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
