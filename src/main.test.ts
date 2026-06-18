// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

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
  daily: [{
    date: "2026-06-11",
    requests: 1,
    totals: {
      inputTokens: 100,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
      outputTokens: 80,
      costCny: 0.4,
    },
  }, {
    date: "2026-06-12",
    requests: 2,
    totals: {
      inputTokens: 900,
      cacheReadTokens: 1_800,
      cacheWriteTokens: 450,
      outputTokens: 720,
      costCny: 0.8,
    },
  }],
  modelDaily: [{
    model: "mimo-v2.5-pro",
    provider: "MiMo Code",
    date: "2026-06-11",
    requests: 1,
    totals: {
      inputTokens: 100,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
      outputTokens: 80,
      costCny: 0.4,
    },
  }, {
    model: "mimo-v2.5-pro",
    provider: "MiMo Code",
    date: "2026-06-12",
    requests: 2,
    totals: {
      inputTokens: 900,
      cacheReadTokens: 1_800,
      cacheWriteTokens: 450,
      outputTokens: 720,
      costCny: 0.8,
    },
  }],
  warnings: [],
};

const allReport = {
  ...report,
  dateMin: "2026-06-01",
  dateMax: "2026-06-14",
  daily: Array.from({ length: 14 }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, "0")}`,
    requests: 1,
    totals: {
      inputTokens: 100 * (index + 1),
      cacheReadTokens: 200 * (index + 1),
      cacheWriteTokens: 50 * (index + 1),
      outputTokens: 80 * (index + 1),
      costCny: Number((0.1 * (index + 1)).toFixed(2)),
    },
  })),
};

describe("application navigation and pricing", () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    invokeMock.mockImplementation((command, args) => {
      if (command === "export_report") return Promise.resolve("C:\\Users\\test\\Downloads\\token-ledger-export.csv");
      if (args?.from === null && args?.to === null) return Promise.resolve(allReport);
      return Promise.resolve(report);
    });
    await import("./main");
    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Token 消耗总览"));
  });

  it("shows token composition percentages with two decimal places", () => {
    document.querySelector<HTMLButtonElement>('[data-page="overview"]')?.click();
    const percentages = Array.from(document.querySelectorAll(".donut-legend small")).map((item) => item.textContent);
    expect(percentages).toEqual(["23.26%", "58.14%", "18.60%"]);
    expect(document.querySelectorAll(".insight-card")).toHaveLength(4);
  });

  it("keeps overview insights based on all records when the custom date range changes", async () => {
    document.querySelector<HTMLButtonElement>('[data-page="overview"]')?.click();
    const before = Array.from(document.querySelectorAll(".insight-card strong")).map((item) => item.textContent);
    const callCount = invokeMock.mock.calls.length;

    const from = document.querySelector<HTMLInputElement>("#from-date");
    const to = document.querySelector<HTMLInputElement>("#to-date");
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    from!.value = "2026-06-11";
    to!.value = "2026-06-12";
    document.querySelector<HTMLButtonElement>("#apply-range")?.click();

    await vi.waitFor(() => expect(invokeMock.mock.calls.length).toBeGreaterThan(callCount));
    const scanArgs = invokeMock.mock.calls.slice(callCount).filter(([command]) => command === "scan_usage").map(([, args]) => args);
    expect(scanArgs).toContainEqual(expect.objectContaining({ from: "2026-06-11", to: "2026-06-12" }));
    expect(scanArgs).toContainEqual(expect.objectContaining({ from: null, to: null }));

    const after = Array.from(document.querySelectorAll(".insight-card strong")).map((item) => item.textContent);
    expect(after).toEqual(before);
  });

  it("exports the current report as CSV and JSON", async () => {
    document.querySelector<HTMLButtonElement>('[data-page="overview"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-export-format="csv"]')?.click();
    await vi.waitFor(() => {
      const lastCall = invokeMock.mock.calls[invokeMock.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe("export_report");
      expect(lastCall?.[1].format).toBe("csv");
      expect(lastCall?.[1].contents).toContain("modelDaily");
    });

    document.querySelector<HTMLButtonElement>('[data-export-format="json"]')?.click();
    await vi.waitFor(() => {
      const lastCall = invokeMock.mock.calls[invokeMock.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe("export_report");
      expect(lastCall?.[1].format).toBe("json");
      expect(lastCall?.[1].contents).toContain('"report"');
    });
  });

  it("opens the model usage and pricing pages from the sidebar", () => {
    document.querySelector<HTMLButtonElement>('[data-page="models"]')?.click();
    expect(document.querySelector("h1")?.textContent).toBe("模型用量");
    expect(document.querySelector(".token-trend-panel h2")?.textContent).toBe("每日 Token 用量");
    expect(document.querySelectorAll(".token-stack-bar")).toHaveLength(2);
    expect(document.querySelectorAll(".token-segment.cache")).toHaveLength(2);
    expect(document.querySelectorAll(".token-segment.input")).toHaveLength(2);
    expect(document.querySelectorAll(".token-segment.output")).toHaveLength(2);
    expect(document.querySelector(".token-stack-bar")?.getAttribute("data-tooltip-title")).toBe("430 Token");
    const styles = readFileSync("src/styles.css", "utf8");
    expect(styles).toContain("--stack-cache");
    expect(styles).toContain("fill:var(--stack-cache");

    const filter = document.querySelector<HTMLSelectElement>("#token-model-filter");
    expect(filter).not.toBeNull();
    filter!.value = "mimo-v2.5-pro";
    filter!.dispatchEvent(new Event("change"));
    expect(document.querySelector(".token-chart-summary")?.textContent).toContain("mimo-v2.5-pro");
    expect(document.querySelectorAll(".token-stack-bar")).toHaveLength(2);

    const search = document.querySelector<HTMLInputElement>("#model-search");
    expect(search).not.toBeNull();
    search!.value = "missing-model";
    search!.dispatchEvent(new Event("input"));
    expect(document.querySelector(".empty-row")?.textContent).toContain("暂无");

    document.querySelector<HTMLButtonElement>('[data-page="pricing"]')?.click();
    expect(document.querySelector("h1")?.textContent).toBe("价格说明");
    expect(document.querySelector('[data-price-row="mimo-v2.5-pro"]')).not.toBeNull();
  });

  it("shows readable chart tooltip content on hover", () => {
    document.querySelector<HTMLButtonElement>('[data-page="overview"]')?.click();
    const point = document.querySelector<SVGCircleElement>(".trend-svg circle");
    expect(point).not.toBeNull();

    point!.dispatchEvent(new Event("mouseenter"));

    expect(document.querySelector("#tooltip strong")?.textContent).toBe(point!.dataset.tooltipTitle);
    expect(document.querySelector("#tooltip span")?.textContent).toBe(point!.dataset.tooltipDetail);
    expect(document.querySelector("#tooltip")?.classList.contains("show")).toBe(true);

    const styles = readFileSync("src/styles.css", "utf8");
    expect(styles).toContain(".tooltip strong { font-size:var(--font-body)!important; }");
    expect(styles).toContain(".tooltip span { font-size:var(--font-secondary)!important; }");
  });

  it("sends a saved custom price into the next usage scan", async () => {
    document.querySelector<HTMLButtonElement>('[data-page="pricing"]')?.click();
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
    expect(document.querySelectorAll("[data-theme-option]")).toHaveLength(6);
    expect(document.querySelector('[data-theme-option="graphite"]')).not.toBeNull();
    expect(document.querySelector('[data-theme-option="forest"]')).not.toBeNull();
    expect(document.querySelector('[data-theme-option="paper"]')).not.toBeNull();

    for (const theme of ["midnight", "ocean", "light", "graphite", "forest", "paper"]) {
      document.querySelector<HTMLButtonElement>(`[data-theme-option="${theme}"]`)?.click();
      expect(document.documentElement.dataset.theme).toBe(theme);
    }
    document.querySelector<HTMLButtonElement>('[data-theme-option="graphite"]')?.click();
    const bodySize = document.querySelector<HTMLInputElement>('[data-font-role="body"]');
    expect(bodySize).not.toBeNull();
    bodySize!.value = "15";
    bodySize!.dispatchEvent(new Event("input"));

    expect(document.documentElement.dataset.theme).toBe("graphite");
    expect(document.documentElement.style.getPropertyValue("--font-body")).toBe("15px");
    expect(JSON.parse(localStorage.getItem("token-ledger-display-settings-v1") ?? "{}")).toEqual({
      theme: "graphite",
      fonts: {
        pageTitle: 28,
        sectionTitle: 15,
        body: 15,
        secondary: 11,
        data: 26,
        table: 12,
        control: 12,
      },
    });
  });

  it("lets the table font setting control estimated cost values", () => {
    document.querySelector<HTMLButtonElement>('[data-page="overview"]')?.click();
    expect(document.querySelector(".models-panel td.money strong")).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-page="display"]')?.click();
    const tableSize = document.querySelector<HTMLInputElement>('[data-font-role="table"]');
    expect(tableSize).not.toBeNull();
    tableSize!.value = "16";
    tableSize!.dispatchEvent(new Event("input"));

    expect(document.documentElement.style.getPropertyValue("--font-table")).toBe("16px");
  });

  it("supports keyboard shortcuts for pages, refresh, and model search focus", async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    expect(document.querySelector("h1")?.textContent).toBe("模型用量");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
    expect(document.activeElement?.id).toBe("model-search");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true }));
    await vi.waitFor(() => {
      const lastCall = invokeMock.mock.calls[invokeMock.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe("scan_usage");
    });
  });
});
