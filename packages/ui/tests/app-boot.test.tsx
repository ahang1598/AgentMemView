import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../src/App.js";

describe("app boot (blank-page regression)", () => {
  it("main entry mounts RouterProvider (never a bare <App />)", () => {
    // A bare <App /> throws "useLocation() may be used only in the context of
    // a <Router>" and leaves a blank page; assert the production wiring.
    const main = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/main.tsx"),
      "utf8",
    );
    expect(main).toContain("RouterProvider");
    expect(main).not.toMatch(/<App\s*\/>/);
  });

  it("router tree renders the shell with sidebar navigation", async () => {
    const testRouter = createMemoryRouter([
      {
        path: "/",
        element: <App />,
        children: [{ index: true, element: <div>overview-stub</div> }],
      },
    ]);
    render(<RouterProvider router={testRouter} />);
    expect(await screen.findByText("AgentMemView")).toBeTruthy();
    expect(screen.getByText("注入面板")).toBeTruthy();
    expect(screen.getByText("检索轨迹")).toBeTruthy();
    expect(screen.getByText("overview-stub")).toBeTruthy();
  });
});
