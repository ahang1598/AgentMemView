# 配置参考

配置文件：`~/.AgentMemView/agentmemview.config.yaml`（缺失时使用内置默认值）。

## 字段（与 zod schema 对应）

| 段 | 键 | 默认 | 说明 |
|----|----|------|------|
| server | host | 127.0.0.1 | core REST 监听地址 |
| server | port | 8620 | core REST + Dashboard 端口 |
| proxy | host | 127.0.0.1 | 透明代理监听地址 |
| proxy | port | 8619 | 代理端口 |
| storage | dataDir | ~/.AgentMemView | 数据库与 pid 目录 |
| embedding | provider | local | local / api / mock |
| embedding | mirror | — | HF 镜像（等价 AGENTMEMVIEW_HF_ENDPOINT） |
| llm | provider | none | none / openai-compat |
| decay | halfLifeDays | 30 | L1 衰减半衰期（Dashboard 滑杆同步） |
| capabilities | * | off | 经 PUT /api/v1/config 热写，键名 `capability.<id>` |

## 环境变量

| 变量 | 说明 |
|------|------|
| AGENTMEMVIEW_ACCESS_KEY | 代理访问密钥（未设时环回开放） |
| AGENTMEMVIEW_HF_ENDPOINT | HF 镜像端点 |
| AGENTMEMVIEW_ALLOW_DOWNLOAD | =1 允许首次下载本地模型 |
| AGENTMEMVIEW_HOME | 接入检测用 HOME（测试/容器） |
| AGENTMEMVIEW_UPSTREAM_BASE | 代理上游覆盖 |

## 热生效

`PUT /api/v1/config` 写 `capability.*` 后无需重启：能力中心状态机在每次 `GET /api/v1/capabilities` 时从 config 表现场推导（off/error/active）。
