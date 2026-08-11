import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AssetsPage from "../../src/pages/assets.js";
import ProfilesPage from "../../src/pages/profiles.js";

const apiMock = vi.hoisted(() => ({
  listSpaces: vi.fn(async () => ({ items: [{ id: "sp1", name: "default" }] })),
  getProfile: vi.fn(async () => ({ contentMd: "# 画像\n用户偏好 pnpm", version: 2 })),
  listScenarios: vi.fn(async () => ({
    items: [{ id: "sc1", title: "重构解析器", summary: "拆分 tokenizer", tokenEstimate: 120 }],
  })),
  listSkills: vi.fn(async () => ({
    items: [{ id: "sk1", name: "commit-flow", version: 3, content: "步骤说明" }],
  })),
}));

vi.mock("../../src/lib/api.js", () => ({ api: apiMock }));

describe("profiles page (M3-09)", () => {
  it("renders profile markdown and scenario token estimates", async () => {
    render(<ProfilesPage />);
    expect(await screen.findByText(/用户偏好 pnpm/)).toBeTruthy();
    expect(await screen.findByText("重构解析器")).toBeTruthy();
    expect(await screen.findByText("120")).toBeTruthy();
  });
});

describe("assets page (M3-10)", () => {
  it("lists skills with version and expandable content", async () => {
    render(<AssetsPage />);
    expect(await screen.findByText("commit-flow")).toBeTruthy();
    expect(await screen.findByText("v3")).toBeTruthy();
  });
});
