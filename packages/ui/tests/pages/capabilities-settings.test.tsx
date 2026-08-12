import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import CapabilitiesPage from "../../src/pages/capabilities.js";
import EvalPage from "../../src/pages/eval.js";
import ProxySettingsPage from "../../src/pages/proxy-settings.js";
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
  applyOnboard: vi.fn(async () => ({ changed: true, note: "ANTHROPIC_BASE_URL -> x" })),
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
  function renderSettings(): void {
    const router = createMemoryRouter([{ path: "/", element: <SettingsPage /> }]);
    render(<RouterProvider router={router} />);
  }

  it("links out to the dedicated proxy settings page and keeps decay slider", async () => {
    renderSettings();
    const entry = await screen.findByTestId("proxy-entry-card");
    expect(entry.textContent).toContain("代理与接入");
    expect(screen.getByText("前往代理配置")).toBeTruthy();
    const decay = await screen.findByTestId("decay-card");
    expect(decay.textContent).toContain("30 天");
    fireEvent.click(screen.getByText("保存"));
    await vi.waitFor(() => {
      expect(apiMock.putConfig).toHaveBeenCalledWith({ decayHalfLifeDays: 30 });
    });
  });

  it("unifies external service (capability) config on the settings page", async () => {
    renderSettings();
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

describe("proxy settings page (unified proxy config)", () => {
  function renderPage(): void {
    const router = createMemoryRouter([{ path: "/", element: <ProxySettingsPage /> }]);
    render(<RouterProvider router={router} />);
  }

  it("renders upstream form + generated proxy start command", async () => {
    renderPage();
    const upstream = await screen.findByTestId("proxy-upstream-card");
    expect(upstream.textContent).toContain("透明代理上游");
    fireEvent.change(await screen.findByLabelText(/Anthropic 协议上游/), {
      target: { value: "https://open.bigmodel.cn/api/anthropic" },
    });
    expect((await screen.findByText(/proxy start --anthropic-upstream/)).textContent).toContain(
      "--anthropic-upstream https://open.bigmodel.cn/api/anthropic",
    );
  });

  it("sends claudeEnv overrides (merge semantics) on apply", async () => {
    renderPage();
    await screen.findByTestId("proxy-wiring-card");
    fireEvent.change(await screen.findByLabelText(/密钥/), { target: { value: "tok-123" } });
    fireEvent.change(await screen.findByLabelText(/模型/), { target: { value: "glm-5.2[1m]" } });
    fireEvent.change(await screen.findByLabelText(/上下文窗口/), {
      target: { value: "1000000" },
    });
    fireEvent.change(await screen.findByLabelText(/请求超时毫秒/), {
      target: { value: "3000000" },
    });
    fireEvent.click(screen.getByText("接入"));
    await vi.waitFor(() => {
      expect(apiMock.applyOnboard).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "claude-code",
          claudeEnv: {
            authToken: "tok-123",
            defaultHaikuModel: "glm-5.2[1m]",
            defaultSonnetModel: "glm-5.2[1m]",
            defaultOpusModel: "glm-5.2[1m]",
            autoCompactWindow: "1000000",
            apiTimeoutMs: "3000000",
          },
        }),
      );
    });
  });
});
