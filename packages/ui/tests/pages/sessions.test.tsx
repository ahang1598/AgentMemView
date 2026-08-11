import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SessionsPage from "../../src/pages/sessions.js";

const apiMock = vi.hoisted(() => ({
  listSessions: vi.fn(async () => ({
    items: [
      { id: "sess-1", startedAt: "2026-08-11T09:00:00.000Z", agentId: "ag1" },
      { id: "sess-2", startedAt: "2026-08-11T14:00:00.000Z", agentId: "ag1" },
    ],
  })),
  sessionDiff: vi.fn(async () => ({
    added: [{ id: "f1", content: "新增事实" }],
    updated: [],
    forgotten: [{ id: "f2", content: "遗忘事实" }],
  })),
}));

vi.mock("../../src/lib/api.js", () => ({ api: apiMock }));

describe("sessions page (M3-08)", () => {
  it("groups sessions by day and shows diff columns", async () => {
    render(<SessionsPage />);
    const diffButton = await screen.findByTestId("diff-sess-1");
    fireEvent.click(diffButton);
    const diffList = await screen.findByTestId("diff-list");
    expect(diffList.textContent).toContain("新增 (1)");
    expect(diffList.textContent).toContain("新增事实");
    expect(diffList.textContent).toContain("遗忘 (1)");
  });

  it("empty diff shows guidance with mem:sync hint", async () => {
    apiMock.sessionDiff.mockResolvedValueOnce({ added: [], updated: [], forgotten: [] });
    render(<SessionsPage />);
    fireEvent.click(await screen.findByTestId("diff-sess-1"));
    const empty = await screen.findByTestId("diff-empty");
    expect(empty.textContent).toContain("本次会话未产生记忆变更");
    expect(empty.textContent).toContain("mem:sync");
  });
});
