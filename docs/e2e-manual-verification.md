# 真实端到端测试流程（Claude Code × AgentMemView × 真实 LLM 网关）

本文档定义并记录一套**真实调用 Claude Code、经透明代理、打到真实大模型网关**的完整验证流程。非 mock、非回放：每一步都有可复现命令与证据来源。

## 0. 测试拓扑

```
Claude Code (claude -p)
  │ ANTHROPIC_BASE_URL=http://127.0.0.1:8619/claude-code/default  （settings.json env）
  ▼
透明代理 :8619 ──x-api-key 原样透传──▶ 智谱 https://open.bigmodel.cn/api/anthropic
  │ 注入 / mem: 短路 / 写回
  ▼
核心 :8620（SQLite + L0 + L1 精炼队列 + Dashboard）
```

## 1. 准备

```powershell
# 1) 构建并启动核心（首次启动自动创建 default 空间）
pnpm build
node packages/cli/bin/agentmemview.js start --foreground --data <测试数据目录>

# 2) 启动代理，指定真实上游
node packages/cli/bin/agentmemview.js proxy start --foreground `
  --anthropic-upstream https://open.bigmodel.cn/api/anthropic

# 3) 在 Dashboard 设置页（或 PUT /api/v1/config）配置 LLM 网关能力
#    capability.llm-gateway = { baseUrl, apiKey, model }  → 状态变 active

# 4) 确认 Claude Code 指向代理
node packages/cli/bin/agentmemview.js init --agent claude-code --force
```

检查点：`GET /api/v1/spaces` 有 default；`GET /api/v1/capabilities` llm-gateway=active。

## 2. 用例清单

| # | 用例 | 操作 | 预期 | 验证端点/证据 |
|---|---|---|---|---|
| T1 | 代理转发真实上游 | curl POST `:8619/claude-code/default/v1/messages`（带 x-api-key） | 200，上游真实回复 | 响应体 `id` 为上游格式 |
| T2 | Claude Code 真实写入 | `claude -p "记住：我偏好 Rust 与 vim 键位"` | 正常回答；对话落库 | `GET /api/v1/l0/messages` 出现 user+assistant |
| T3 | L1 精炼（自动） | T2 后等待约 5s+LLM 调用 | 任务队列消化，产出 L1 事实 | `GET /api/v1/jobs`（deadLetters=0）、`GET /api/v1/memories` |
| T4 | 记忆注入 | 新会话 `claude -p "我的偏好是什么？"` | 请求携带注入块 | `GET /api/v1/injections` 出现 memory-guide/facts 块 |
| T5 | mem: 指令短路 | curl POST 消息 `mem:status` | 本地合成响应（零上游调用） | 响应 `id` 为 `agentmemview_*` |
| T6 | 首启引导 | 全新数据目录启动 core | 自动存在 default 空间 | `GET /api/v1/spaces` |
| T7 | 失败降级 | 上游限流（429） | 退避重试，超限入 DLQ 可查 | `GET /api/v1/jobs` deadLetters、jobs_dlq.last_error |

## 3. 自动化回归覆盖

以上链路在单测/集成层均有门禁化回归（CI 可跑，不依赖外部网关）：

- `packages/proxy/tests/harness/harness.test.ts` — 新空间无 agent 全链路（自动建 agent + 写回落库）
- `packages/proxy/tests/forwardHeaders.test.ts` — Expect/TE 等 undici 不兼容头剥离
- `packages/core/tests/http/refine-wiring.test.ts` — 首启引导 + L0 写回 → 精炼任务 → worker 产出 L1 事实（全链路真实 HTTP）
- `packages/core/tests/dao/bootstrap.test.ts` — 默认空间引导幂等性
- `packages/core/tests/providers/llm.test.ts` — 429/5xx 退避重试策略

## 4. 2026-08-12 实测记录（真实环境）

环境：Windows 25H2，Claude Code 2.1.226，上游=智谱（真实账号密钥），数据目录 `%TEMP%\amv-e2e`。

| 用例 | 结果 | 证据 |
|---|---|---|
| T1 | ✅ | 代理 200，`REPLY=PROXY-OK`（智谱 glm-4.6 真实生成） |
| T2 | ✅ | `claude -p` 回答正常；L0 落库 45+ 条（含工具调用轮次），user/assistant 齐全 |
| T3 | ⚠️ 管线已接通，LLM 调用被智谱 429 配额阻塞 | 任务入队→worker 认领→3 次退避重试→DLQ（last_error="llm gateway responded 429"，直连最小请求同样 429，证实为账户配额）；启发式策略全链路已由 refine-wiring 回归测试证明（事实成功产出） |
| T4 | ✅ | `claude -p "我最喜欢的语言？"` 正确回答 Rust+vim；`GET /injections` 12 条 memory-guide 块记录 |
| T5 | ✅ | curl `mem:status` 返回 `id=agentmemview_*` 本地合成响应（零上游 token） |
| T6 | ✅ | 全新目录启动即有 default 空间 |
| T7 | ✅ | 429 → 3 次退避 → DLQ，错误信息完整可诊断 |

### 实测发现并修复的真实缺陷（本轮）

1. **Expect 头导致转发崩溃**：PowerShell 客户端发 `Expect: 100-continue`，undici 拒绝（UND_ERR_NOT_SUPPORTED）→ 代理剥离 expect/te 头。
2. **gzip 双重解压**：fetch 自动解压但透传 `content-encoding`，客户端二次解压失败 → 转发响应剥离 encoding/length 头。
3. **首启无默认空间**：全新库无任何空间，代理静默降级（无会话/无注入/无写回）→ `bootstrapDefaultTenants` 幂等引导。
4. **L1 精炼从未接线**：`scheduleSessionRefine` 无调用方、worker 未装配 → L0 写回触发（去重+5s 防抖）+ 服务启动装配 worker（策略热配置）。
5. **mem: 指令在真实 Agent 下失效**：Claude Code 把 tool_result 追加为更靠后的 user 消息 → 改为扫描全部 user 消息定位 mem: 前缀。
6. **429 重试不足**：provider 只对 5xx 重试一次 → 429/5xx 三次退避重试。
7. **502 无诊断**：代理错误不透传 cause → 502 携带 cause message/code 并打日志。

## 5. 复测注意

- 智谱免费配额对 `/api/paas/v4/chat/completions` 限流较严（T3 依赖该端点）；配额恢复后重跑 T3 即可，无需改代码。
- `claude -p` 的首个请求可能是无 prompt 的后台辅助请求，mem: 验证建议用 curl 直发（T5）。
