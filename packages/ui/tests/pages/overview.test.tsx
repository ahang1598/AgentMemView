import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "../../src/pages/overview.js";

const apiMock = vi.hoisted(() => ({
  listSpaces: vi.fn(),
  listMemories: vi.fn(),
  listInjections: vi.fn(),
  listTraces: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock("../../src/lib/api.js", () => ({ api: apiMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("overview page (M3-03)", () => {
  it("renders stat cards from real response shape", async () => {
    apiMock.listSpaces.mockResolvedValue({ items: [{ id: "sp1", name: "default" }] });
    apiMock.listMemories.mockResolvedValue({ items: [{ id: "f1" }, { id: "f2" }] });
    apiMock.listInjections.mockResolvedValue({
      items: [{ id: "i1", createdAt: new Date().toISOString() }],
    });
    apiMock.listTraces.mockResolvedValue({ items: [{ id: "t1" }] });
    apiMock.listSessions.mockResolvedValue({ items: [{ id: "s1" }] });

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("overview-stats")).toBeTruthy();
    });
    expect(screen.getByText("记忆总量")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("empty state guides to onboarding", async () => {
    apiMock.listSpaces.mockResolvedValue({ items: [{ id: "sp1", name: "default" }] });
    apiMock.listMemories.mockResolvedValue({ items: [] });
    apiMock.listInjections.mockResolvedValue({ items: [] });
    apiMock.listTraces.mockResolvedValue({ items: [] });
    apiMock.listSessions.mockResolvedValue({ items: [] });

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("还没有任何记忆")).toBeTruthy();
    });
    expect(screen.getByText("前往接入向导")).toBeTruthy();
  });
});
