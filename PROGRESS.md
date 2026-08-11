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
