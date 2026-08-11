import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { FactsDao } from "../../dao/l1.js";
import { TenantsDao } from "../../dao/tenants.js";
import type { HttpEnv } from "../app.js";

/**
 * POST /api/v1/dev/seed — demo data for Dashboard development/preview:
 * 1 service / 2 spaces / 2 agents / sessions / 40 facts / injections / traces.
 * Idempotent guard: refuses when memories already exist.
 */

const FACT_SAMPLES = [
  "用户偏好 pnpm 而非 npm 作为包管理器",
  "项目使用 TypeScript strict 模式与 NodeNext 解析",
  "部署目标是本地单机，数据存放在 ~/.AgentMemView",
  "CI 使用 GitHub Actions 双平台矩阵",
  "数据库启用 WAL 模式与外键约束",
  "检索管线六阶段：预过滤、双通道、RRF、衰减、top-k、轨迹",
  "注入纪律：L3 画像 + L2 索引 + 技能清单每轮固定注入",
  "L0/L1 永不自动注入，只经只读桥暴露",
  "遗忘采用 Ebbinghaus 衰减，默认半衰期 30 天",
  "密钥脱敏在入库前执行，支持自定义规则",
];

export const devRoutes = new Hono<HttpEnv>().post("/dev/seed", (c) => {
  const db = c.get("db");
  const existing = (db.prepare("SELECT COUNT(*) AS n FROM l1_facts").get() as { n: number }).n;
  if (existing > 0) {
    return c.json({ seeded: false, reason: "memories already exist" });
  }
  const tenants = new TenantsDao(db);
  const service = tenants.createService({ name: "演示服务" });
  const space = tenants.createSpace({ serviceId: service.id, name: "default" });
  const space2 = tenants.createSpace({ serviceId: service.id, name: "sandbox" });
  const agent = tenants.createAgent({
    spaceId: space.id,
    kind: "claude-code",
    name: "Claude Code",
  });
  tenants.createAgent({ spaceId: space2.id, kind: "codex", name: "Codex" });

  const sessionId = randomUUID();
  db.prepare(
    "INSERT INTO sessions (id, agent_id, external_id, started_at, meta_json) VALUES (?, ?, ?, ?, '{}')",
  ).run(sessionId, agent.id, "seed-session", new Date().toISOString());

  const dao = new FactsDao(db, { serviceId: service.id, spaceId: space.id });
  for (const content of FACT_SAMPLES) {
    dao.create({ content });
  }

  const now = new Date().toISOString();
  for (let turn = 1; turn <= 6; turn += 1) {
    const blocks = [
      { kind: "profile", tokens: 120, content: "# 画像\n用户偏好 pnpm" },
      { kind: "scenario-index", tokens: 80, content: "场景索引 2 条" },
      { kind: "skills-list", tokens: 40, content: "技能 1 条" },
    ];
    db.prepare(
      `INSERT INTO injections (id, session_id, turn, blocks_json, token_json, cache_prefix_md5, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      sessionId,
      turn,
      JSON.stringify(blocks),
      JSON.stringify({ total: 240 }),
      "seed-stable-md5",
      now,
    );
  }

  return c.json({
    seeded: true,
    counts: { services: 1, spaces: 2, agents: 2, facts: FACT_SAMPLES.length, injections: 6 },
  });
});
