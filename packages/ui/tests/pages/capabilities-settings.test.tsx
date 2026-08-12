import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CapabilitiesPage from "../../src/pages/capabilities.js";
import EvalPage from "../../src/pages/eval.js";
import SettingsPage from "../../src/pages/settings.js";

const apiMock = vi.hoisted(() => ({
  getCapabilities: vi.fn(async () => ({
    items: [
      {
        key: "llm-gateway",
        title: "LLM 网关",
        state: "off",
        unlocks: "解锁精炼",
        requires: ["baseUrl", "apiKey"],
      },
      {
        key: "sidecar",
        title: "Python Sidecar",
        state: "off",
        unlocks: "embed",
        requires: [],
        hint: "未安装：uv tool install agentmemview-sidecar",
      },
    ],
  })),
  putConfig: vi.fn(async () => ({})),
  getOnboardStatus: vi.fn(async () => ({
    items: [{ agent: "claude-code", detected: true, note: "ok" }],
  })),
  getConfig: vi.fn(async () => ({ decayHalfLifeDays: 30 })),
}));

vi.mock("../../src/lib/api.js", () => ({ api: apiMock }));

describe("capabilities page (M3-11)", () => {
  it("cards show state and required config keys", async () => {
    render(<CapabilitiesPage />);
    const list = await screen.findByTestId("capability-list");
    expect(list.textContent).toContain("LLM 网关");
    expect(list.textContent).toContain("未配置");
    expect(list.textContent).toContain("baseUrl");
    expect(list.textContent).toContain("uv tool install agentmemview-sidecar");
  });

  it("toggling opens config form; save PUTs config", async () => {
    render(<CapabilitiesPage />);
    const configureButtons = await screen.findAllByText("配置");
    fireEvent.click(configureButtons[0] as HTMLElement);
    const input = await screen.findByLabelText(/API 地址/);
    fireEvent.change(input, { target: { value: "http://gateway" } });
    fireEvent.click(screen.getByText("保存并热生效"));
    await vi.waitFor(() => {
      expect(apiMock.putConfig).toHaveBeenCalledWith({
        "capability.llm-gateway": { baseUrl: "http://gateway" },
      });
    });
    expect(await screen.findByTestId("save-result")).toBeTruthy();
  });

  it("clear-and-disable saves null to turn the capability off", async () => {
    render(<CapabilitiesPage />);
    const configureButtons = await screen.findAllByText("配置");
    fireEvent.click(configureButtons[0] as HTMLElement);
    fireEvent.click(screen.getByText("清空并停用"));
    await vi.waitFor(() => {
      expect(apiMock.putConfig).toHaveBeenCalledWith({ "capability.llm-gateway": null });
    });
  });
});

describe("eval page (M3-13)", () => {
  it("renders empty state with dataset import guide", () => {
    render(<EvalPage />);
    expect(screen.getByText("还没有评测报告")).toBeTruthy();
    expect(screen.getByText(/LongMemEval-S/)).toBeTruthy();
  });

  it("renders report table from fixture", () => {
    render(
      <EvalPage
        reports={[
          { dataset: "synthetic", recallAt5: 0.9, recallAt10: 0.95, mrr: 0.8, ranAt: "now" },
        ]}
      />,
    );
    expect(screen.getByTestId("eval-table").textContent).toContain("90%");
  });
});

describe("settings page (M3-12)", () => {
  it("shows onboard detection and decay slider", async () => {
    render(<SettingsPage />);
    const onboard = await screen.findByTestId("onboard-card");
    expect(onboard.textContent).toContain("claude-code");
    expect(onboard.textContent).toContain("已接入");
    const decay = await screen.findByTestId("decay-card");
    expect(decay.textContent).toContain("30 天");
    fireEvent.click(screen.getByText("保存"));
    await vi.waitFor(() => {
      expect(apiMock.putConfig).toHaveBeenCalledWith({ decayHalfLifeDays: 30 });
    });
  });

  it("unifies external service (capability) config on the settings page", async () => {
    render(<SettingsPage />);
    const section = await screen.findByTestId("external-services-card");
    expect(section.textContent).toContain("外部服务");
    expect(section.textContent).toContain("LLM 网关");
    // configure from settings: same PUT contract as the capability center
    const configureButtons = screen.getAllByText("配置");
    fireEvent.click(configureButtons[0] as HTMLElement);
    const baseUrl = await screen.findByLabelText(/API 地址/);
    const apiKey = await screen.findByLabelText(/API Key/);
    expect(apiKey.getAttribute("type")).toBe("password");
    fireEvent.change(baseUrl, { target: { value: "https://open.bigmodel.cn/api/paas/v4" } });
    fireEvent.change(apiKey, { target: { value: "sk-test" } });
    fireEvent.click(screen.getByText("保存并热生效"));
    await vi.waitFor(() => {
      expect(apiMock.putConfig).toHaveBeenCalledWith({
        "capability.llm-gateway": {
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          apiKey: "sk-test",
        },
      });
    });
  });
});
