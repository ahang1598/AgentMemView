# AgentMemView 完整接入指导手册（Claude Code 示例）

本手册覆盖从零接入的每一步：启动服务、配置代理、解释 `<spaceId>`、连接你的真实大模型网关、验证与排错。以 Claude Code + 智谱（`https://open.bigmodel.cn/api/anthropic`）为例，其他 Agent / 网关替换对应字段即可。

## 0. 架构图：请求如何流动

```
Claude Code ──ANTHROPIC_BASE_URL──▶ 透明代理 :8619 ──真实网关──▶ 智谱/GLM 等 LLM
                                        │  注入记忆 / 写回对话
                                        ▼
                                    核心服务 :8620（SQLite + FTS + 向量）
                                        ▲
                                   Dashboard（同一端口，浏览器打开即 UI）
```

- **核心服务（:8620）**：记忆存储、检索、REST API、Dashboard 页面。必须先启动。
- **透明代理（:8619）**：Agent 的新 base-url。它做三件事：① 注入相关记忆到请求；② 原样转发到你的真实 LLM 网关（API Key 随请求原样透传，代理不保存任何密钥）；③ 把对话写回记忆。
- **`<spaceId>`**：隔离空间（类比租户/工作区）。首次启动核心时自动创建名为 `default` 的空间。URL 中的 `<spaceId>` 填**空间名或空间 id** 均可（如 `default`）。在 Dashboard「设置」页可看到/创建空间；也可用 `--space` 参数指定。

## 1. 启动核心服务

```powershell
# 仓库根目录（pnpm install && pnpm build 之后）
node packages/cli/bin/agentmemview.js start
```

- 前台运行加 `--foreground`；数据目录用 `--data <目录>`（默认 `~/.AgentMemView`）。
- 打开 <http://127.0.0.1:8620/> 应看到 Dashboard（侧边栏：总览/注入面板/记忆浏览…）。
- 记下你的空间：Dashboard「设置」页显示空间列表；默认空间名为 `default`。

## 2. 启动透明代理（关键：配置真实大模型网关）

代理必须知道把请求转发到**哪里**。用 `--anthropic-upstream` 指定你的真实网关（这里填智谱）：

```powershell
node packages/cli/bin/agentmemview.js proxy start `
  --anthropic-upstream https://open.bigmodel.cn/api/anthropic
```

后台运行加 `-d`（生成 pid 文件，`proxy stop` 停止）。启动后会打印解析结果，请核对上游指向是否正确：

```
agentmemview proxy listening on http://127.0.0.1:8619
  anthropic upstream -> https://open.bigmodel.cn/api/anthropic
  core               -> http://127.0.0.1:8620
```

**上游解析优先级**（从高到低）：

1. `--anthropic-upstream` / `--openai-upstream` 命令行参数
2. 环境变量 `AGENTMEMVIEW_UPSTREAM_ANTHROPIC` / `AGENTMEMVIEW_UPSTREAM_OPENAI`（或通用的 `AGENTMEMVIEW_UPSTREAM_BASE`）
3. Agent 自己的环境变量 `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`（若它们没有指向代理自身 8619，避免回环）
4. 默认值 `https://api.anthropic.com` / `https://api.openai.com`

**API Key 不用配给代理**：Claude Code 自己携带的 `x-api-key`（你的智谱 key）会被原样透传到上游。所以你只需保证 Claude Code 侧的密钥配置不变（`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`）。

也可以直接用独立可执行文件：`agentmemview-proxy`（环境变量同上：`AGENTMEMVIEW_CORE_URL`、`AGENTMEMVIEW_UPSTREAM_ANTHROPIC`、`AGENTMEMVIEW_PROXY_PORT` 等）。

## 3. 把 Claude Code 指向代理

`<spaceId>` 填第 1 步里的空间名（默认 `default`）：

```powershell
node packages/cli/bin/agentmemview.js init --agent claude-code --space default
```

等价于写入 `~/.claude/settings.json`：

```json
{ "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:8619/claude-code/default" } }
```

**如果报 `conflict: ANTHROPIC_BASE_URL already set to ...`**：说明 Claude 已指向你原来的网关（如智谱地址）。两个选择：

- 加 `--force` 让 init 覆盖（自动备份，`init --restore` 可还原）：

  ```powershell
  node packages/cli/bin/agentmemview.js init --agent claude-code --space default --force
  ```

- 或手动把 `settings.json` 里的 `ANTHROPIC_BASE_URL` 改成代理地址。

> 注意顺序：你原来的网关地址（智谱）不要丢——它现在要配给**代理**的 `--anthropic-upstream`（第 2 步），而 Claude 的 base-url 换成代理地址。

## 4. 验证端到端

1. 确认核心在线：浏览器打开 <http://127.0.0.1:8620/>，Dashboard 正常渲染。
2. 确认代理在线：`curl http://127.0.0.1:8620/health` 与代理日志中的上游指向。
3. 在 Claude Code 里发一条消息，例如「记住：我偏好 TypeScript 严格模式」。
4. 回到 Dashboard「记忆浏览」→ 刷新 → 应看到 `L0` 对话原文落库；随后 `L1` 事实（如偏好）出现。
5. 再问一次相关问题（如「我的编码偏好是什么？」），「注入面板」应显示本次注入的记忆；「检索轨迹」可按 traceId 展开六个阶段。
6. 在 Claude Code 里直接输入 mem 指令验证双向通道：`mem:search TypeScript`、`mem:stats`。

## 5. 其他 Agent

- **Codex**：`init --agent codex`（写 `~/.codex/config.toml` 的 `base_url`；OpenAI 协议对应 `--openai-upstream`）。
- **OpenCode**：`init --agent opencode`（写 `~/.config/opencode/opencode.json`）。
- 通用接入规则：任何支持自定义 base-url 的客户端，把 base-url 设为 `http://127.0.0.1:8619/{agentId}/{spaceId}` 即可；`{agentId}` 任意（如 `claude-code`、`codex`、`opencode`），`{spaceId}` 为空间名/id。裸路径 `/v1/messages`、`/v1/chat/completions` 也可用（路由到默认空间）。

## 6. 常见问题

| 现象 | 原因与处理 |
|---|---|
| `http://127.0.0.1:8620/` 空白 | 未构建 UI：执行 `pnpm install && pnpm build` 后重启核心。仍空白则看浏览器控制台报错并反馈 |
| Dashboard 显示「核心服务不可用: Illegal invocation」 | 旧版本缺陷（fetch 绑定），请拉取最新代码重新构建 |
| `init` 报 conflict | 见第 3 步：`--force` 覆盖或手动修改 |
| Claude 请求 401/403 | 上游鉴权失败：确认 Claude 侧密钥（智谱 key）有效；代理透传密钥，不代管 |
| 代理 502 bad_gateway | 上游网关不可达：核对 `proxy start` 打印的 upstream 指向；`curl <upstream>` 自测 |
| 429 rate_limited | 默认 600 次/分钟/空间+模型；用 `--qpm` 相关配置调大 |
| 改了代理端口 | `proxy start --port <n>` + `init --proxy-url http://127.0.0.1:<n>` 重新写入 |

## 7. 卸载 / 还原

```powershell
node packages/cli/bin/agentmemview.js init --restore   # 还原 Agent 配置（备份自动恢复）
node packages/cli/bin/agentmemview.js proxy stop       # 停止代理
node packages/cli/bin/agentmemview.js stop             # 停止核心
```

数据目录 `~/.AgentMemView` 可整体删除（含备份文件 `*.agentmemview-backup`）。
