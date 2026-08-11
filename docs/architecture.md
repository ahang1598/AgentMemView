# 架构

## 组件

```
agent(Claude Code/Codex/OpenCode)
   │  ANTHROPIC_BASE_URL / OPENAI_BASE_URL 指向代理
   ▼
proxy :8619 ── 认证→分类→会话映射→注入→限流→转发→tee→写回 ──► 上游 LLM
   │ 写回 L0（脱敏）/ 注入记录
   ▼
core :8620 ── REST + SSE + Dashboard 静态托管
   │  SQLite(WAL) + FTS5(trigram) + sqlite-vec
   ▼
jobs 队列 ── refine.l1 / eval.run / embedding.rebuild / decay scan
sidecar(stdio JSON-RPC) ── embed（选配，三态降级）
```

## 检索管线（六阶段，检索期零 LLM）

1. prefilter：scope（space/agent）SQL 预过滤
2. 双通道：FTS5 trigram BM25 ∥ sqlite-vec 余弦（各 top30）
3. RRF(k=60) 融合
4. Ebbinghaus 衰减 ×0.5^(days/halfLife) + 实体 boost(+0.1)，pinned 豁免
5. status=active 过滤 + top-k（默认 8）
6. retrieval_traces 全阶段落盘（Dashboard 可回放）

## 注入纪律（AC-03）

每轮固定注入 = L3 画像 + L2 索引 + 技能清单 + memory_search 指引；前缀字节稳定，MD5 监控（Dashboard 绿/红指示）。L0/L1 永不自动注入，只经只读桥。sidequery/fork 完全跳过。

## 基线与调参结论

- 合成基线：200 事实/40 查询，默认参数 R@5 ≥ 0.85（core 测试门禁）。
- 默认参数（channelTopK=30, rrfK=60, boost=0.1, halfLife=30d）在中文 trigram 场景达标，未触发调参序列；LongMemEval-S 全量跑分待数据集环境（见 PROGRESS M5 偏差）。

## 向量命名空间治理（AC-10 延伸）

`vec_facts_{provider}_{model}_{dims}` 按三元组分表；切换 provider 建新表 + pending_rebuild 标记 + rebuild 入队；检索对未重建命名空间降级为关键词通道，不拒绝服务。
