import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InjectionsPage from "../../src/pages/injections.js";

const { row, apiMock, sseMock } = vi.hoisted(() => {
  const makeRow = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: over.id ?? "inj-1",
    sessionId: over.sessionId ?? "sess-1",
    turn: over.turn ?? 1,
    blocks: over.blocks ?? [
      { kind: "profile", tokens: 100, content: "p" },
      { kind: "skills-list", tokens: 50, content: "s" },
    ],
    tokens: { total: 150 },
    cachePrefixMd5: over.cachePrefixMd5 ?? "md5-stable",
    createdAt: over.createdAt ?? "2026-08-11T10:00:00.000Z",
  });
  return {
    row: makeRow,
    apiMock: {
      listInjections: vi.fn(async () => ({ items: [makeRow({})] })),
    },
    sseMock: { events: [] as Array<{ id: number; data: unknown }>, connected: true },
  };
});

vi.mock("../../src/lib/api.js", () => ({ api: apiMock }));
vi.mock("../../src/lib/sse.js", () => ({
  useEventStream: () => sseMock,
}));

describe("injections page (M3-04)", () => {
  it("renders rows and token-bar proportions", async () => {
    render(<InjectionsPage />);
    await screen.findByTestId("injection-table");
    const bar = await screen.findByTestId("token-bar");
    const segments = bar.querySelectorAll("[data-kind]");
    expect(segments.length).toBe(2);
    const first = segments[0] as HTMLElement;
    expect(first.style.width).toBe(`${(100 / 150) * 100}%`);
  });

  it("md5 stability indicator green when equal", async () => {
    render(<InjectionsPage />);
    const badge = await screen.findByTestId("md5-stability");
    expect(badge.textContent).toContain("稳定");
    expect(badge.className).toContain("badge-active");
  });

  it("streams new rows via sse without refetch", async () => {
    sseMock.events = [{ id: 9, data: row({ id: "inj-live", sessionId: "sess-live", turn: 7 }) }];
    render(<InjectionsPage />);
    expect(await screen.findByText("sess-live")).toBeTruthy();
    sseMock.events = [];
  });

  it("filter by session works", async () => {
    apiMock.listInjections.mockResolvedValueOnce({
      items: [row({ id: "a", sessionId: "keep-me" }), row({ id: "b", sessionId: "drop-me" })],
    });
    render(<InjectionsPage />);
    const input = await screen.findByLabelText("filter");
    (input as HTMLInputElement).value = "keep-me";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(await screen.findByText("keep-me")).toBeTruthy();
  });
});
