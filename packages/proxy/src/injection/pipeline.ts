import type { AgentContext } from "../adapters/types.js";
import {
  computePrefixMd5,
  estimateTokens,
  type InjectionBlockRecord,
  type InjectionRecord,
  PrewarmCache,
} from "./prewarm.js";

/**
 * Fixed per-turn injection (Spec section 5 injection discipline):
 * L3 profile + L2 scenario index + skills list + memory guide ONLY.
 * L0/L1 are never auto-injected (read-only bridge/tools expose them).
 * Budget priority when over maxTokens: profile > skills-list >
 * scenario-index > memory-guide (memory guide is tiny; kept when it fits).
 */

export interface ScenarioIndexEntry {
  id: string;
  title: string;
  summary: string;
  tokenEstimate: number;
}

export interface SkillListEntry {
  name: string;
  oneLiner: string;
}

export interface InjectionSources {
  getProfile(spaceId: string): Promise<string | null>;
  getScenarioIndex(spaceId: string): Promise<ScenarioIndexEntry[]>;
  getSkillsList(spaceId: string): Promise<SkillListEntry[]>;
}

export interface RunInput {
  sessionId: string;
  spaceId: string;
  turn: number;
  /** sidequery/fork classification → skip injection entirely. */
  skip?: boolean | undefined;
}

export interface RunResult {
  blocks: InjectionBlockRecord[];
  totalTokens: number;
  cachePrefixMd5: string;
}

export interface PipelineOptions {
  sources: InjectionSources;
  /** Injection token budget; default 2000. */
  maxTokens?: number | undefined;
  /** Persistence hook (writes the injections table via core). */
  record?: ((rec: InjectionRecord) => void) | undefined;
}

const DEFAULT_MAX_TOKENS = 2000;

const MEMORY_SEARCH_TOOL: Record<string, unknown> = {
  name: "memory_search",
  description:
    "Search long-term memory (facts, scenarios, knowledge). Use when the user refers to past decisions or preferences.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" }, top_k: { type: "number" } },
    required: ["query"],
  },
};

export class InjectionPipeline {
  readonly #sources: InjectionSources;
  readonly #maxTokens: number;
  readonly #record?: ((rec: InjectionRecord) => void) | undefined;
  readonly #prewarm = new PrewarmCache();

  constructor(options: PipelineOptions) {
    this.#sources = options.sources;
    this.#maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#record = options.record;
  }

  async run(ctx: AgentContext, input: RunInput): Promise<RunResult> {
    if (input.skip === true) {
      return { blocks: [], totalTokens: 0, cachePrefixMd5: "" };
    }

    const [profile, scenarios, skills] = await Promise.all([
      this.#sources.getProfile(input.spaceId).catch(() => null),
      this.#sources.getScenarioIndex(input.spaceId).catch(() => []),
      this.#sources.getSkillsList(input.spaceId).catch(() => []),
    ]);

    const candidates: InjectionBlockRecord[] = [];
    if (profile !== null && profile.trim().length > 0) {
      const content = renderProfile(profile);
      candidates.push({ kind: "profile", tokens: estimateTokens(content), content });
    }
    if (skills.length > 0) {
      const content = renderSkills(skills);
      candidates.push({ kind: "skills-list", tokens: estimateTokens(content), content });
    }
    if (scenarios.length > 0) {
      const content = renderScenarioIndex(scenarios);
      const tokens = scenarios.reduce((sum, s) => sum + s.tokenEstimate, 0);
      candidates.push({ kind: "scenario-index", tokens, content });
    }
    const guideContent = JSON.stringify(MEMORY_SEARCH_TOOL);
    candidates.push({
      kind: "memory-guide",
      tokens: estimateTokens(guideContent),
      content: guideContent,
    });

    // budget: priority order already matches candidates order
    const blocks: InjectionBlockRecord[] = [];
    let total = 0;
    for (const block of candidates) {
      if (total + block.tokens > this.#maxTokens) {
        continue; // lower-priority block dropped; higher ones kept
      }
      blocks.push(block);
      total += block.tokens;
    }

    // apply to the IR: injected texts become the system prefix (before
    // native blocks); the memory guide appends a read-only search tool
    for (const block of blocks) {
      if (block.kind === "memory-guide") {
        ctx.injections.toolsAppend.push(MEMORY_SEARCH_TOOL);
      } else {
        ctx.injections.systemPrefix.push(block.content);
      }
    }

    const cachePrefixMd5 = computePrefixMd5(blocks);
    this.#prewarm.set(input.sessionId, cachePrefixMd5);
    this.#record?.({
      sessionId: input.sessionId,
      turn: input.turn,
      blocks,
      tokenJson: { total: total },
      cachePrefixMd5,
      createdAt: new Date().toISOString(),
    });
    return { blocks, totalTokens: total, cachePrefixMd5 };
  }
}

function renderProfile(profile: string): string {
  return `[AgentMemView L3 profile]\n${profile.trim()}`;
}

function renderSkills(skills: SkillListEntry[]): string {
  const lines = skills.map((s) => `- ${s.name}: ${s.oneLiner}`);
  return `[AgentMemView skills]\n${lines.join("\n")}`;
}

function renderScenarioIndex(scenarios: ScenarioIndexEntry[]): string {
  const lines = scenarios.map(
    (s) => `- ${s.title}: ${s.summary} (~${s.tokenEstimate} tokens, read on demand)`,
  );
  return `[AgentMemView scenario index]\n${lines.join("\n")}`;
}
