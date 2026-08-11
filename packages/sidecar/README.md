# agentmemview-sidecar

AgentMemView 的 Python 选配进程：stdio JSON-RPC 服务（每行一个 JSON 对象）。

## 契约（Spec 第 10 节，冻结）

| 方法 | v1 | 说明 |
|------|----|------|
| `handshake` | 实现 | 返回 name/version/protocol/methods |
| `embed` | 实现 | `{texts[], model?}` → `{vectors[][], dims}`（fastembed） |
| `rerank` / `cluster` / `consolidate` | v1.5 | 返回 -32601 not implemented |

单向依赖：sidecar 永不反向调用 core。

## 安装

```bash
uv tool install ./packages/sidecar
# 或开发模式
cd packages/sidecar && uv sync
```

## 运行与测试

```bash
agentmemview-sidecar           # stdio 服务
uv run pytest                  # 协议测试
```

core 会在启动时握手探测；未安装时能力中心显示「未安装」并自动降级到默认 embedding provider（AC-09）。
