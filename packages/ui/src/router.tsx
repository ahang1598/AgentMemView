import { createBrowserRouter } from "react-router-dom";
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

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
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
    ],
  },
]);
