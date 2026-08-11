# AgentMemView

本地单机的编码 agent 记忆系统：透明代理沉淀对话、可观测的记忆血缘与检索轨迹、离线优先。

## 30 秒说明

AgentMemView 通过一个透明代理（:8619）接入 Claude Code / Codex / OpenCode：每轮对话自动脱敏入库（L0），启发式/LLM 精炼为原子事实（L1），混合检索（FTS5 trigram + sqlite-vec + RRF + Ebbinghaus 衰减）并把每次检索的六阶段决策完整落盘（retrieval traces）。Dashboard（:8620）实时展示注入、血缘、轨迹与能力开关。未开启任何选配能力时全功能离线可用。

## 安装

```bash
git clone https://github.com/ahang1598/AgentMemView.git
cd AgentMemView
pnpm install
pnpm build
```

## 启动与验证

```bash
node packages/cli/bin/agentmemview.js start          # core REST :8620（含 Dashboard）
node packages/cli/bin/agentmemview.js doctor --json  # 环境体检
curl http://127.0.0.1:8620/api/v1/health             # {"ok":true}
```

## 接入编码 agent

```bash
node packages/cli/bin/agentmemview.js init --agent claude-code
# 或 codex / opencode；--restore 可还原
```

详见 `docs/onboarding/claude-code.md`。

## 能力表

| 能力 | 默认 | 开启方式 |
|------|------|----------|
| L0 写回 / L1 CRUD / 混合检索 / 轨迹 | 开启 | — |
| LLM 精炼（L1/L2/L3） | 关闭 | Dashboard 能力中心配置 OpenAI 兼容网关（热生效） |
| Embedding API | 关闭 | 能力中心配置（向量命名空间自动治理） |
| Python sidecar（embed） | 未安装 | `uv tool install ./packages/sidecar` |

## 包结构

- `packages/core` — 引擎：存储/检索/任务队列/能力中心/REST + Dashboard 静态托管
- `packages/proxy` — 透明代理（双协议适配/注入/写回）
- `packages/mcp` — MCP server（8 工具，stdio）
- `packages/ui` — Dashboard（React 19，10 页面）
- `packages/eval` — 评测 harness（LongMemEval-S/LoCoMo 加载器 + R@k/MRR）
- `packages/cli` — CLI（init/start/stop/export/import/doctor）
- `packages/sidecar` — Python uv 项目（JSON-RPC stdio）

## 开发

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
node packages/ui/scripts/scan-rules.mjs   # P0 视觉纪律扫描
```

MIT License。
