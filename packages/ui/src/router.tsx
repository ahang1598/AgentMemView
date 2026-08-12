import { createBrowserRouter, Link, useRouteError } from "react-router-dom";
import App from "./App.js";
import AssetsPage from "./pages/assets.js";
import CapabilitiesPage from "./pages/capabilities.js";
import EvalPage from "./pages/eval.js";
import InjectionsPage from "./pages/injections.js";
import MemoriesPage from "./pages/memories.js";
import MemoryDetailPage from "./pages/memory-detail.js";
import OverviewPage from "./pages/overview.js";
import ProfilesPage from "./pages/profiles.js";
import SessionsPage from "./pages/sessions.js";
import SettingsPage from "./pages/settings.js";
import TracesPage from "./pages/traces.js";

function NotFoundPage() {
  return (
    <div className="card">
      <h3>页面不存在</h3>
      <p className="muted">
        该路径不是 Dashboard 页面。若你在探测服务状态，健康检查地址为{" "}
        <code className="mono">/api/v1/health</code> 或 <code className="mono">/health</code>。
      </p>
      <Link className="btn btn-primary" to="/">
        返回总览
      </Link>
    </div>
  );
}

function RouteErrorBoundary() {
  const error = useRouteError() as { status?: number } | undefined;
  if (error?.status === 404) {
    return <NotFoundPage />;
  }
  return (
    <div className="card">
      <h3>页面出错了</h3>
      <p className="muted">{error instanceof Error ? error.message : "未知错误"}</p>
      <Link className="btn btn-primary" to="/">
        返回总览
      </Link>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "injections", element: <InjectionsPage /> },
      { path: "memories", element: <MemoriesPage /> },
      { path: "memories/:id", element: <MemoryDetailPage /> },
      { path: "traces", element: <TracesPage /> },
      { path: "sessions", element: <SessionsPage /> },
      { path: "profiles", element: <ProfilesPage /> },
      { path: "assets", element: <AssetsPage /> },
      { path: "capabilities", element: <CapabilitiesPage /> },
      { path: "eval", element: <EvalPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
