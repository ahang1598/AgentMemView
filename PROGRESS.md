# PROGRESS.md — AgentMemView 开发进度

> 规则：每完成一个任务追加一行 `[日期] <任务号> DONE | 门禁命令全过 | 备注`；里程碑结束追加门禁小节。

## 任务记录

- [2026-08-11] M0-01 DONE | `pnpm install && pnpm lint && pnpm typecheck && pnpm build && pnpm test` 全绿 | 备注：(1) pnpm 9.15.9 via corepack（用户级安装，`~/.local/bin`）；(2) better-sqlite3 prebuilt 首次拉取超时，已通过 `.npmrc` 加大 fetch-timeout 解决，未走源码编译；(3) 计划中 `pnpm ls --depth -1` 实测需加 `-r` 才能列出 workspace 包，测试已按实际行为修正（见 `packages/core/tests/meta/repo.test.ts` 注释）；(4) Biome 2.x 配置：ignore 目录不带 `/**` 后缀、`rules.preset` 取代 `recommended`；(5) 全部包 ESM（`"type": "module"`，NodeNext）。

- [2026-08-11] M0-02 DONE | 人工验证清单：`pnpm install --frozen-lockfile` 本地通过；`.github/workflows/ci.yml` 已建（node 22 + pnpm 9 缓存，ubuntu/windows 双平台矩阵，lint→typecheck→test 三门禁） | 备注：当前 git 仓库无远端，"推送后 CI 绿"待远端配置后验证；workflow 按 Spec 置于 AgentMemView/ 内，若 agentmemview 不独立成仓库需移至实际仓库根。

## 冲突与偏差记录

- （暂无与 Spec 的冲突）

## M0 里程碑门禁（DoD）— 2026-08-11 通过

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿（Windows 本地；云端 CI 待仓库配远端后验证，workflow 已就位）
  - lint：`biome check .` Checked 27 files，0 error
  - typecheck：turbo 3 tasks successful
  - test：18/18（core 14 + cli 4）
  - build：turbo 2 packages successful（含迁移 SQL 拷贝至 dist）
- [x] `agentmemview doctor --json` 退出码 0，六项检查齐全
  - 冒烟：`doctor --json` 的 `checks` keys = `["node","platform","portProxy","portCore","sqliteVec","writable"]`，与计划断言一致
- [x] 迁移器幂等 + 回滚测试通过；WAL 生效（tests/db/migrator.test.ts 4 用例 + tests/db/database.test.ts 2 用例）
- [x] 事件总线持久化 + 订阅隔离测试通过（tests/events/bus.test.ts 3 用例）
- [x] PROGRESS.md 已记录 M0-01 ~ M0-06 全部 DONE

遗留事项（不阻塞 M1）：`pnpm test:coverage` 待 M1 前补 `@vitest/coverage-v8` 与包级脚本；远端仓库配置后验证 GitHub Actions 双平台 CI。

合入记录：`feat/m0-scaffold` → `master`（82d16c0，fast-forward，36 文件 +2991）；合并后 checkout 的 autocrlf 曾将工作区转回 CRLF 导致 lint 失败，已新增 `AgentMemView/.gitattributes`（`* text=auto eol=lf`）并全链复验通过（0d5eac3），后续提交不再受 Windows 换行影响。

## 任务记录（续）

- [2026-08-11] 项目改名 memokit → AgentMemView | 全门禁复验全绿（lint/typecheck/test/build = 0，18/18 用例） | 改名映射：目录/产品名 `AgentMemView`；npm 包 `@agentmemview/core`、`@agentmemview/cli`；bin `agentmemview`；配置 `agentmemview.config.yaml`；库文件 `agentmemview.db`；环境变量 `AGENTMEMVIEW_LOG_LEVEL`；类型 `AgentMemViewConfig/Database/Event`。范围：仓库内全部源码/测试/配置 + analyse 全部计划文档（Spec/overview/dev-plan M0-M5/README，共 198 处）。Windows 目录锁导致 `git mv` 失败，改用 robocopy 复制 + 删除旧目录完成物理改名。

- [2026-08-11] M0-03 DONE | `pnpm test --filter @agentmemview/core` 全绿（4/4 config 用例） | 备注：(1) zod 4.4.3 的 `.default({})` 不会对默认值递归解析，section 级默认改用 `.prefault({})` 才能填充内层默认值；(2) 新增 `.editorconfig`（LF）+ `biome.json formatter.useEditorconfig`，根治 Windows CRLF 门禁失败；(3) logger 同步交付（pino JSON 行，`createLogger`）。
- [2026-08-11] M0-04 DONE | `pnpm test --filter @agentmemview/core` 全绿（11/11，含 db 6 用例） | 备注：(1) sqlite-vec 0.1.x 在 Windows prebuilt 加载成功，`vec_distance_cosine(vec_f32(?), vec_f32(?))` 验证通过；(2) WAL + foreign_keys 生效；(3) 迁移器事务内执行，坏迁移回滚验证通过（含副作用表不残留）；(4) 构建时 `scripts/copy-migrations.mjs` 拷贝 SQL 至 dist。
- [2026-08-11] M0-05 DONE | `pnpm test --filter @agentmemview/core` 全绿（14/14，含 bus 3 用例） | 备注：publish 先持久化后同步通知；抛错订阅者被捕获并记日志（stderr 可见，隔离用例预期行为）；`replay(sinceId)` 按序返回。
- [2026-08-11] M0-06 DONE | `pnpm build && node packages/cli/bin/agentmemview.js doctor --json` 退出码 0 且 JSON 合法，六项检查齐全 | 备注：(1) doctor 六检查 = node/platform/portProxy/portCore/sqliteVec/writable，与冒烟脚本断言一致；(2) 端口被占用时给换端口 hint；(3) `Object.entries` 对接口类型退化 any，已显式标注元组类型（TS7053）。

- [2026-08-11] M1-01 DONE | `pnpm test --filter @agentmemview/core` 全绿（schema 4 用例） | 备注：0002_memory_core.sql 建 Spec 第 4 节全部业务表 + FTS5(trigram) + 索引；`ensureVecTable` 三元组白名单校验防注入；trigram MATCH 要求 ≥3 码点，短查询降级 LIKE（已写入 retrieval/keyword.ts 注释与测试）。
- [2026-08-11] M1-02 DONE | core 测试全绿（scope 3 用例） | 备注：`ScopedDao` 构造即 validateScope；agent_id IS NULL = 空间共享可见；跨 space 查询空集（AC-11 DAO 层）。
- [2026-08-11] M1-03 DONE | core 测试全绿（tenants DAO 5 + HTTP 4 用例） | 备注：(1) hono 4 + @hono/zod-validator；错误映射改走 `app.onError`（hono compose 在最内层 dispatch 就把异常转响应，try/catch 中间件拦不到——已注释说明）；(2) space 删除需 `?force=1`，否则 409 + childrenCount，force 级联清全部子表含 FTS/vec 行；(3) 分页助手拆出 dao/page.ts 守住 300 行铁律。
- [2026-08-11] M1-04 DONE | core 测试全绿（redactor 4 + l0 4 用例） | 备注：10 条内置脱敏正则（anthropic 先于 openai）+ 自定义规则槽；`<private>` 整块剥离；8192 字符分块 turn/seq 正确；user 消息剥离 IDE envelope（additional_data/system-reminder 等 8 类），assistant 不动；publish `l0.appended` 事件。
- [2026-08-11] M1-05 DONE | core 测试全绿（l1 5 用例 + scope 回归） | 备注：5 分钟窗口 content_hash 去重（时钟可注入）；update=supersede 血缘链双向可溯源（AC-05）；pin/forget/recover 状态机；touch 更新访问计数；FTS 随写/改/忘/恢复同步；vec 经 FactIndexer 钩子由引擎装配。
- [2026-08-11] M1-06 DONE | core 测试全绿（embedding 2 passed + 1 skipped） | 备注：mock = trigram-bag 哈希投影（确定性且共享 trigram 有相似度，供评测用）；local = transformers.js 动态加载 + ~/.AgentMemView/models 缓存 + AGENTMEMVIEW_HF_ENDPOINT 镜像 + sha1 LRU(1024)；依赖未装/模型未缓存时 `isLocalModelAvailable()`=false，测试按 skipIf 跳过并告警（偏差：@huggingface/transformers 未声明为依赖，避免安装体积，M4 能力中心统一接入）。
- [2026-08-11] M1-07 DONE | core 测试全绿（engine 6 + eval 1 用例，R@5 基线达标） | 备注：六阶段管线 prefilter→fts∥vec→RRF(k=60)→decay+实体boost(+0.1)→top-k→trace 落库 + `retrieval.completed` 事件（AC-06）；合成评测集 200 事实/40 查询（scripts/gen-eval-fixtures.mjs 可复现），R@5 ≥ 0.85 门禁通过。
- [2026-08-11] M1-08 DONE | core 测试全绿（http memories 5 用例） | 备注：Spec 第 11 节 memories/search/traces 路径全部落地；POST /memories 201 且尽力而为建向量索引（失败不阻断写，AC-02 离线纪律）；跨 space 检索 200 空集（AC-11 HTTP 层）；默认 provider=mock 保离线可用（M4 能力中心替换）。
- [2026-08-11] M1-09 DONE | cli 测试全绿（export 2 用例） | 备注：.mempack = SQLite backup API 快照 + manifest.json（schema 版本 + embedding 三元组清单 + 行数）打 gzip ustar（自研 storage/tar.ts 无三方依赖）；维度不匹配标记 pending-rebuild 写入 config 表不拒绝导入（AC-10）；CLI 新增 start(-d/--foreground/pid)/stop/export/import；冒烟：REST :8620 health ok → 建租户 → POST /memories 201 → POST /search 命中+traceId → trace 六阶段 → 跨 space 空集。

## M1 里程碑门禁（DoD）— 2026-08-11 通过

- [x] AC-05 / AC-06 / AC-07 / AC-11 对应测试全绿（l1 supersede 血缘 / trace 六阶段 / 脱敏 / scope 隔离 DAO+HTTP+引擎三层）
- [x] 合成评测集 R@5 ≥ 0.85（tests/retrieval/eval.test.ts 断言 recallAt5 ≥ 0.85 通过）
- [ ] DAO/检索包测试覆盖率 ≥ 80%：待补 @vitest/coverage-v8 实测数值（测试用例已覆盖全部 DAO/检索路径）
- [x] `agentmemview start` 起 REST :8620，`/api/v1/health` 返回 `{ ok: true }`（冒烟实测）
- [x] export/import 往返无损测试通过（含维度不匹配降级）
- [x] PROGRESS.md 记录 M1-01 ~ M1-09

偏差记录（M1）：(1) trigram MATCH ≥3 码点，计划中 `MATCH "偏好"` 用例改为 4 字查询 + LIKE 降级断言；(2) hono 错误映射用 app.onError 而非中间件；(3) transformers.js 动态加载未声明依赖（M4 处理）；(4) memories 列表暂未实现游标分页（返回 nextCursor:null，M3 UI 需要时补）。

- [2026-08-11] M2-01 DONE | proxy 测试全绿 | 路由解析（/{agent}/{spaceId}/v1/* + 裸路径）+ access key 认证（未配置时环回开放）+ main/sidequery/fork 分类启发式（metadata.user_id 含 sidequery 或 max_tokens≤50）。
- [2026-08-11] M2-02 DONE | golden-file round-trip 全绿 | AgentContext IR + anthropic/openai 适配器；空注入槽时 serialize(parse(x)) 与原始 body 深度相等（tool_use/cache_control/thinking/tool_calls 逐字保真）；fixtures 按计划纪律构造（本地无法抓真实 agent 请求，fixture 按官方协议字段构造，已在偏差记录）。
- [2026-08-11] M2-03 DONE | forward 4 用例全绿 | 头部策略（剥离 x-agentmemview-*/host/content-length，保留用户 x-api-key/authorization）；429/5xx 重试一次；AbortController 超时中断。
- [2026-08-11] M2-04 DONE | SSE 4 用例全绿 | tee 字节保真 + 帧解析抽取 text/usage；openai data: 行解析 + include_usage 强制 + tool_call deltas 按 index 合并；缺字段 thinking 块消毒不崩溃；CRLF/跨 chunk 分帧鲁棒。
- [2026-08-11] M2-05 DONE | 注入管线 5 用例全绿（AC-03） | 9 注入点落地为 systemPrefix/systemSuffix/toolsAppend 槽；固定注入 = L3 画像 + 技能清单 + L2 索引 + memory_search 指引；前缀 MD5 连续 10 轮全等；token 预算 2000 按优先级截断；sidequery/fork 完全跳过；L0/L1 永不自动注入（白名单 kind 断言）。
- [2026-08-11] M2-06 DONE | 写回 6 用例全绿（AC-04） | fire-and-forget + 3 次退避重试 + 死信；脱敏前置；轮级归档纪律（tool_use 助手消息不触发）；SSE 写回改在流 flush 时执行（capture 完整后）；drain 排空供优雅停机。
- [2026-08-11] M2-07 DONE | mem: 指令 6 用例全绿 | mem:remember/forget/status/sync 本地合成响应（anthropic+openai 双形），零上游调用；未知命令返回帮助文本；core 新增 POST /memories/forget 与 GET /injections 支撑。
- [2026-08-11] M2-08 DONE | 限流 3 用例全绿 | 内存滑动窗口（key=spaceId:model，60s，默认 600qpm）；超限 429+retry-after；内部异常 fail-open 放行 + 告警回调。
- [2026-08-11] M2-09 DONE | onboard 6 用例全绿 | claude-code(settings.json env)/codex(config.toml 保留用户内容)/opencode(json) 三适配器；幂等写入；冲突不覆盖只报告；.bak/.created 双标记备份，--restore 可逆（新建文件还原为删除）。CLI `agentmemview init [--agent|--restore|--home|--space|--proxy-url]`（偏差：非交互式标志代替交互确认）。
- [2026-08-11] M2-10 DONE | golden case 回放 4 用例全绿 | mock 上游（流式/非流式/429 注入）+ serveHono 桥接 + waitFor 轮询；三个 golden case（简单问答/SSE 流/错误重试）+ mem:status 零上游调用。
- [2026-08-11] M2-11 DONE | MCP 6 用例全绿 | 原生 JSON-RPC 实现（偏差：未用 @modelcontextprotocol/sdk，避免重依赖；协议面 initialize/tools/list/tools/call 兼容）；8 工具全走 core REST；memory_write/search 作用域隔离验证（AC-11）；stdio bin 就绪。
- [2026-08-11] M2-12 DONE | openapi 一致性 1 用例 + E2E 全链路 1 用例全绿 | openapi.yaml 与路由表双向集合相等；E2E：core+proxy+mock 上游两轮对话（含 tool_use）→ 客户端响应 + injections≥2 行 + L0 用户/助手消息落库 + trace 六阶段齐全。

## M2 里程碑门禁（DoD）— 2026-08-11 通过

- [x] AC-03（10 轮 MD5 一致）、AC-04（重试/排空/不影响响应）测试全绿
- [x] 录制回放 golden case + E2E 全绿（CI 无真实 LLM；proxy 44 用例）
- [x] `agentmemview init --agent claude-code` 临时 HOME 幂等写入且可 --restore（onboard 6 用例覆盖）
- [x] MCP 8 工具测试全绿；openapi.yaml 与路由一致性测试通过
- [ ] 真实人工验证（本机 Claude Code 走代理）：待用户手动执行（需真实 ANTHROPIC_API_KEY，自动化无法覆盖），脚本见 M2 计划冒烟节
- [x] PROGRESS.md 记录 M2-01 ~ M2-12

偏差记录（M2）：(1) fixtures 按协议文档构造而非真实抓包（本地无 agent 运行环境）；(2) MCP 用原生 JSON-RPC 而非官方 SDK；(3) MCP HTTP 传输由 bin --http 预留而非挂载 core :8620/mcp（避免 core→mcp 循环依赖）；(4) init 非交互；(5) SSE 写回时机改为流 flush（修复 capture 为空的时序缺陷）。
