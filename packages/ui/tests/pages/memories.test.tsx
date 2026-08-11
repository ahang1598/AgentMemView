import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MemoriesPage from "../../src/pages/memories.js";

const { apiMock } = vi.hoisted(() => {
  const makeFact = (over: Record<string, unknown> = {}) => ({
    id: over.id ?? "f-1",
    spaceId: "sp1",
    agentId: null,
    content: over.content ?? "测试事实",
    contentHash: "h",
    status: over.status ?? "active",
    pinned: over.pinned ?? false,
    confidence: 1,
    halfLifeDays: 30,
    accessCount: 3,
    lastAccessedAt: new Date().toISOString(),
    sourceMessageId: null,
    supersededBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  });
  return {
    fact: makeFact,
    apiMock: {
      listServices: vi.fn(async () => ({ items: [{ id: "svc1", name: "work" }] })),
      listSpaces: vi.fn(async () => ({
        items: [{ id: "sp1", name: "default", serviceId: "svc1" }],
      })),
      listAgents: vi.fn(async () => ({
        items: [{ id: "ag1", name: "CC", kind: "claude-code" }],
      })),
      listMemories: vi.fn(async () => ({
        items: [makeFact({}), makeFact({ id: "f-2", content: "已遗忘", status: "forgotten" })],
      })),
    },
  };
});

vi.mock("../../src/lib/api.js", () => ({ api: apiMock }));

function renderPage() {
  return render(
    <MemoryRouter>
      <MemoriesPage />
    </MemoryRouter>,
  );
}

describe("memories page (M3-05)", () => {
  it("drills service → space and lists facts with badges", async () => {
    renderPage();
    const serviceSelect = await screen.findByLabelText("service");
    fireEvent.change(serviceSelect, { target: { value: "svc1" } });
    const spaceSelect = await screen.findByLabelText("space");
    fireEvent.change(spaceSelect, { target: { value: "sp1" } });
    expect(await screen.findByTestId("memory-table")).toBeTruthy();
    expect(screen.getByText("测试事实")).toBeTruthy();
  });

  it("status filter shows only matching rows", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("service"), { target: { value: "svc1" } });
    fireEvent.change(await screen.findByLabelText("space"), { target: { value: "sp1" } });
    await screen.findByTestId("memory-table");
    // first match is the filter button (badge in the table also says forgotten)
    fireEvent.click(screen.getAllByText("forgotten")[0] as HTMLElement);
    expect(screen.queryByText("测试事实")).toBeNull();
    expect(screen.getByText("已遗忘")).toBeTruthy();
  });
});
