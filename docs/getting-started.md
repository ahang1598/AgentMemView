# Getting Started（5 分钟从零到第一次注入可视）

## 1. 安装（1 分钟）

```bash
git clone https://github.com/ahang1598/AgentMemView.git
cd AgentMemView
pnpm install
pnpm build
```

## 2. 启动 core（30 秒）

```bash
node packages/cli/bin/agentmemview.js start
```

打开 http://127.0.0.1:8620 —— Dashboard 总览页。空库时显示接入引导。

可选：注入演示数据：

```bash
curl -X POST http://127.0.0.1:8620/api/v1/dev/seed
```

## 3. 写入第一条记忆并检索（1 分钟）

```bash
# 建租户（种子数据已建可跳过）
curl -X POST localhost:8620/api/v1/services -H 'Content-Type: application/json' -d '{"name":"work"}'
curl -X POST localhost:8620/api/v1/spaces -H 'Content-Type: application/json' -d '{"serviceId":"<svc-id>","name":"default"}'

# 写记忆
curl -X POST localhost:8620/api/v1/memories -H 'Content-Type: application/json' \
  -d '{"spaceId":"<space-id>","content":"用户偏好 pnpm 而非 npm"}'

# 检索（返回 results + traceId）
curl -X POST localhost:8620/api/v1/search -H 'Content-Type: application/json' \
  -d '{"spaceId":"<space-id>","query":"包管理器偏好"}'
```

## 4. 观察轨迹与注入（1 分钟）

- Dashboard「检索轨迹」页：点开刚才的 trace，六阶段（prefilter→fts/vec→rrf→decay→final）候选全回放。
- Dashboard「注入面板」页：代理产生注入后实时出现（SSE），token 占比条 + MD5 稳定指示器。

## 5. 接入真实 agent（1 分钟）

```bash
node packages/cli/bin/agentmemview.js init --agent claude-code
```

随后正常使用 claude，对话将自动经代理脱敏入库。还原：`init --agent claude-code --restore`。
