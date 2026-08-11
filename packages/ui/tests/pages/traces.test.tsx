import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TracesPage from "../../src/pages/traces.js";

const { apiMock } = vi.hoisted(() => {
  const makeStages = [
    { stage: "prefilter", candidates: ["a", "b", "c"] },
    { stage: "fts", candidates: ["a", "b"] },
    { stage: "vec", candidates: ["b", "c"] },
    { stage: "rrf", candidates: ["b", "a", "c"] },
    { stage: "decay", candidates: ["b", "a"] },
    { stage: "final", candidates: ["b"] },
  ];
  return {
    stages: makeStages,
    apiMock: {
      listTraces: vi.fn(async () => ({
        items: [
          {
            id: "t-1",
            query: "包管理器偏好",
            latencyMs: 12.5,
            createdAt: "2026-08-11T10:00:00.000Z",
          },
        ],
      })),
      getTrace: vi.fn(async () => ({
        id: "t-1",
        query: "包管理器偏好",
        latencyMs: 12.5,
        createdAt: "2026-08-11T10:00:00.000Z",
        stages: makeStages,
        results: [],
      })),
    },
  };
});

vi.mock("../../src/lib/api.js", () => ({ api: apiMock }));

describe("traces page (M3-07)", () => {
  it("lists traces with latency", async () => {
    render(<TracesPage />);
    expect(await screen.findByTestId("trace-table")).toBeTruthy();
    expect(screen.getByText("包管理器偏好")).toBeTruthy();
    expect(screen.getByTestId("trace-latency").textContent).toContain("12.5ms");
  });

  it("stepper renders six stages with candidate counts", async () => {
    render(<TracesPage />);
    fireEvent.click(await screen.findByTestId("open-trace-t-1"));
    const stepper = await screen.findByTestId("trace-stepper");
    expect(stepper.textContent).toContain("预过滤");
    expect(stepper.textContent).toContain("RRF 融合");
    expect(stepper.textContent).toContain("(3)");
  });

  it("clicking stage shows candidate list", async () => {
    render(<TracesPage />);
    fireEvent.click(await screen.findByTestId("open-trace-t-1"));
    await screen.findByTestId("trace-stepper");
    fireEvent.click(screen.getByText(/最终集/));
    const candidates = await screen.findByTestId("stage-candidates");
    expect(candidates.textContent).toContain("最终集 候选");
  });
});
