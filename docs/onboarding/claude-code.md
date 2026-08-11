# 接入指南：Claude Code

## 一键接入

```bash
node packages/cli/bin/agentmemview.js init --agent claude-code
# 指定空间/代理端口
node packages/cli/bin/agentmemview.js init --agent claude-code --space myproject --proxy-url http://127.0.0.1:8619
```

## 写入的配置

`~/.claude/settings.json` 的 `env` 段：

```json
{ "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:8619/claude-code/<spaceId>" } }
```

幂等：已接入时不重复写；已有其他 `ANTHROPIC_BASE_URL` 时只报告冲突不覆盖。

## 验证

```bash
node packages/cli/bin/agentmemview.js start      # core+Dashboard
# 代理需单独起（M2 产物，监听 :8619）
claude "你好"                                     # 正常响应
curl localhost:8620/api/v1/injections             # 出现注入记录
curl localhost:8620/api/v1/l0/messages            # 对话已脱敏入库
```

## 还原

```bash
node packages/cli/bin/agentmemview.js init --agent claude-code --restore
```

写入前自动备份为 `settings.json.agentmemview.bak`；还原恢复原文件，init 新建的文件则直接删除。
