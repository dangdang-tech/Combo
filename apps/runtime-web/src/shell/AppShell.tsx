import { Outlet } from 'react-router-dom';
import { CloudReviewBar } from './CloudReviewBar.js';

export function AppShell() {
  return (
    <div className="rt-shell">
      <header className="rt-topbar" aria-label="应用工具">
        <CloudReviewBar />
      </header>
      <main className="rt-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
