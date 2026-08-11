// Deterministic generator for the synthetic retrieval eval fixture.
// Output: ../src/retrieval/eval-fixtures/synthetic.json (200 facts / 40 queries).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOPICS = 40;
const FACTS_PER_TOPIC = 5;

const FILLERS = [
  "用于生产环境的部署流程说明",
  "涉及缓存策略与超时参数的取值",
  "与监控告警阈值的联动规则",
  "对应回滚方案与灰度开关的配合",
  "需要与上游服务的版本兼容确认",
];

function keyword(index) {
  return `配置组${String(index).padStart(2, "0")}`;
}

const facts = [];
const queries = [];
for (let t = 0; t < TOPICS; t += 1) {
  const topic = `topic-${t}`;
  const key = keyword(t);
  for (let f = 0; f < FACTS_PER_TOPIC; f += 1) {
    facts.push({
      content: `${key} 第${f + 1}条记录：${FILLERS[f]}，编号 ${t * 10 + f}。`,
      topic,
    });
  }
  queries.push({ query: `${key} 第3条`, topic });
}

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/retrieval/eval-fixtures",
);
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "synthetic.json"),
  `${JSON.stringify({ facts, queries }, null, 2)}\n`,
  "utf8",
);
console.log(`fixture written: ${facts.length} facts, ${queries.length} queries`);
