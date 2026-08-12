import {
  Activity,
  BookOpen,
  Brain,
  Database,
  GitBranch,
  Home,
  Network,
  PackagePlus,
  Route,
  Settings,
  SlidersHorizontal,
  Target,
  Zap,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "总览", icon: Home, end: true },
  { to: "/injections", label: "注入面板", icon: Zap },
  { to: "/memories", label: "记忆浏览", icon: Database },
  { to: "/traces", label: "检索轨迹", icon: Route },
  { to: "/sessions", label: "会话", icon: GitBranch },
  { to: "/profiles", label: "画像与场景", icon: Brain },
  { to: "/assets", label: "技能与知识", icon: BookOpen },
  { to: "/capabilities", label: "能力中心", icon: SlidersHorizontal },
  { to: "/eval", label: "评测中心", icon: Target },
  { to: "/settings", label: "设置", icon: Settings, end: true },
  { to: "/settings/proxy", label: "代理配置", icon: Network },
  { to: "/settings/optional", label: "选配设置", icon: PackagePlus },
];

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="sidebar-title">
          <Activity size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          AgentMemView
        </h1>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
