import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MemoryDetailPage from "../../src/pages/memory-detail.js";

const { apiMock } = vi.hoisted(() => {
  const makeChain = [
    {
      id: "f-old",
      spaceId: "sp1",
      agentId: null,
      content: "部署在 AWS",
      contentHash: "h1",
      status: "superseded",
      pinned: false,
      confidence: 1,
      halfLifeDays: 30,
      accessCount: 0,
      lastAccessedAt: "2026-08-10T00:00:00.000Z",
      sourceMessageId: "m-1",
      supersededBy: "f-new",
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    },
    {
      id: "f-new",
      spaceId: "sp1",
      agentId: null,
      content: "部署在阿里云",
      contentHash: "h2",
      status: "active",
      pinned: false,
      confidence: 1,
      halfLifeDays: 30,
      accessCount: 0,
      lastAccessedAt: "2026-08-11T00:00:00.000Z",
      sourceMessageId: null,
      supersededBy: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
  ];
  return {
    chain: makeChain,
    apiMock: {
      getMemoryLineage: vi.fn(async () => ({ chain: makeChain })),
      updateMemory: vi.fn(async () => makeChain[1]),
      pinMemory: vi.fn(async () => makeChain[1]),
      forgetByQuery: vi.fn(async () => ({ forgotten: 1 })),
    },
  };
});

vi.mock("../../src/lib/api.js", () => ({ api: apiMock }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/memories/f-new"]}>
      <Routes>
        <Route path="/memories/:id" element={<MemoryDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("memory detail page (M3-06)", () => {
  it("lineage tree renders old → new with source message", async () => {
    renderPage();
    const tree = await screen.findByTestId("lineage-tree");
    expect(tree.textContent).toContain("部署在 AWS");
    expect(tree.textContent).toContain("部署在阿里云");
    expect(tree.textContent).toContain("m-1");
  });

  it("edit opens dialog and submit calls PATCH", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("edit-button"));
    const dialog = await screen.findByTestId("edit-dialog");
    expect(dialog.textContent).toContain("supersede");
    const textarea = screen.getByLabelText("edit-content") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "部署在腾讯云" } });
    fireEvent.click(screen.getByText("保存新版本"));
    await vi.waitFor(() => {
      expect(apiMock.updateMemory).toHaveBeenCalledWith("f-new", "部署在腾讯云");
    });
  });

  it("pin confirms then calls api", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByTestId("pin-button"));
    await vi.waitFor(() => {
      expect(apiMock.pinMemory).toHaveBeenCalledWith("f-new", true);
    });
  });
});
