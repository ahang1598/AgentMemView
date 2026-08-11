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
