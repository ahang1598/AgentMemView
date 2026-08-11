# 故障排查

## 本地模型下载失败

- 症状：doctor 报 local embedding 不可用。
- 处理：设置镜像 `AGENTMEMVIEW_HF_ENDPOINT=https://hf-mirror.com`，并 `AGENTMEMVIEW_ALLOW_DOWNLOAD=1` 后重启；或手动将模型放入 `~/.AgentMemView/models`。系统会自动降级为关键词检索（FTS 通道），不拒绝服务。

## 端口被占用

- 症状：`start` 报 EADDRINUSE。
- 处理：`doctor` 会给出换端口提示；`--port`/配置 `server.port` 更换。

## 能力状态含义

| 状态 | 含义 | 动作 |
|------|------|------|
| off | 未配置 | 能力中心填表保存 |
| error | 配置缺字段 | 按 error 消息补齐（字段级） |
| active | 生效中 | — |
| sidecar 未安装 | 未检测到进程 | `uv tool install ./packages/sidecar` |

## 如何重置

- 清空数据：停止服务后删除 `~/.AgentMemView/agentmemview.db*`。
- 还原 agent 接入：`agentmemview init --agent <name> --restore`。
- 重建向量：切换 embedding provider 后 rebuild 任务自动入队；`GET /api/v1/jobs` 查看进度。

## 写回失败

代理写回 core 采用 3 次指数退避；持续失败进死信（`GET /api/v1/jobs` 的 deadLetters 计数）。响应流永不受影响（fail-open 纪律）。
