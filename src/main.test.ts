// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const report = {
  sourceDir: "C:\\Users\\test\\.claude\\projects",
  filesScanned: 2,
  recordsCount: 3,
  dateMin: "2026-06-01",
  dateMax: "2026-06-12",
  totals: {
    inputTokens: 1_000,
    cacheReadTokens: 2_000,
    cacheWriteTokens: 500,
    outputTokens: 800,
    costCny: 1.2,
  },
  models: [{
    model: "mimo-v2.5-pro",
    provider: "MiMo Code",
    requests: 3,
    priced: false,
    customPriced: false,
    price: { model: "mimo-v2.5-pro", input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    totals: {
      inputTokens: 1_000,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 500,
      outputTokens: 800,
      costCny: 0,
    },
  }],
  daily: [],
  warnings: [],
};

describe("application navigation and pricing", () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    invokeMock.mockResolvedValue(report);
    await import("./main");
    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Token 消耗总览"));
  });

  it("shows token composition percentages with two decimal places", () => {
    document.querySelector<HTMLButtonElement>('[data-page="overview"]')?.click();
    const percentages = Array.from(document.querySelectorAll(".donut-legend small")).map((item) => item.textContent);
    expect(percentages).toEqual(["23.26%", "58.14%", "18.60%"]);
  });

  it("opens the model usage and pricing pages from the sidebar", () => {
    document.querySelector<HTMLButtonElement>('[data-page="models"]')?.click();
    expect(document.querySelector("h1")?.textContent).toBe("模型用量");

    document.querySelector<HTMLButtonElement>('[data-page="pricing"]')?.click();
    expect(document.querySelector("h1")?.textContent).toBe("价格说明");
    expect(document.querySelector('[data-price-row="mimo-v2.5-pro"]')).not.toBeNull();
  });

  it("sends a saved custom price into the next usage scan", async () => {
    const output = document.querySelector<HTMLInputElement>('[data-price-row="mimo-v2.5-pro"] [data-price-field="output"]');
    expect(output).not.toBeNull();
    output!.value = "8";
    document.querySelector<HTMLButtonElement>('[data-price-row="mimo-v2.5-pro"] .save-price')?.click();

    await vi.waitFor(() => {
      const lastCall = invokeMock.mock.calls[invokeMock.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe("scan_usage");
      expect(lastCall?.[1].customPrices).toEqual([
        { model: "mimo-v2.5-pro", input: 0, cacheRead: 0, cacheWrite: 0, output: 8 },
      ]);
    });
  });

  it("opens display settings and persists theme and semantic font sizes", () => {
    document.querySelector<HTMLButtonElement>('[data-page="display"]')?.click();
    expect(document.querySelector('[data-theme-option="light"]')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-theme-option="light"]')?.click();
    const bodySize = document.querySelector<HTMLInputElement>('[data-font-role="body"]');
    expect(bodySize).not.toBeNull();
    bodySize!.value = "15";
    bodySize!.dispatchEvent(new Event("input"));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--font-body")).toBe("15px");
    expect(JSON.parse(localStorage.getItem("token-ledger-display-settings-v1") ?? "{}")).toEqual({
      theme: "light",
      fonts: {
        pageTitle: 24,
        sectionTitle: 14,
        body: 15,
        secondary: 10,
        data: 22,
        table: 11,
        control: 11,
      },
    });
  });
});
