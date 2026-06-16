import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type Totals = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costCny: number;
};

type ModelPrice = {
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

type ModelUsage = {
  model: string;
  provider: string;
  requests: number;
  priced: boolean;
  customPriced: boolean;
  price: ModelPrice;
  totals: Totals;
};

type DailyUsage = {
  date: string;
  requests: number;
  totals: Totals;
};

type ModelDailyUsage = DailyUsage & {
  model: string;
  provider: string;
};

type UsageReport = {
  sourceDir: string;
  filesScanned: number;
  recordsCount: number;
  dateMin: string | null;
  dateMax: string | null;
  totals: Totals;
  models: ModelUsage[];
  daily: DailyUsage[];
  modelDaily: ModelDailyUsage[];
  warnings: string[];
};

type Page = "overview" | "models" | "pricing" | "display";
type Theme = "midnight" | "ocean" | "light" | "graphite" | "forest" | "paper";
type FontRoleSizes = {
  pageTitle: number;
  sectionTitle: number;
  body: number;
  secondary: number;
  data: number;
  table: number;
  control: number;
};
type DisplaySettings = { theme: Theme; fonts: FontRoleSizes };

const app = document.querySelector<HTMLDivElement>("#app")!;
const PRICE_STORAGE_KEY = "token-ledger-custom-prices-v1";
const DISPLAY_STORAGE_KEY = "token-ledger-display-settings-v1";
const USD_TO_CNY_TEXT = "7.20";
const DEFAULT_FONTS: FontRoleSizes = {
  pageTitle: 28,
  sectionTitle: 15,
  body: 13,
  secondary: 11,
  data: 26,
  table: 12,
  control: 12,
};
let activeRange = "30";
let activePage: Page = "overview";
let currentFrom: string | null = null;
let currentTo: string | null = null;
let currentReport: UsageReport | null = null;
let currentInsightsReport: UsageReport | null = null;
let selectedTokenChartModel = "all";
let modelSearch = "";
let modelProviderFilter = "all";
let customPrices = loadCustomPrices();
let displaySettings = loadDisplaySettings();

applyDisplaySettings();

const demoDaily: DailyUsage[] = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(2026, 4, 14 + index);
  const factor = 0.45 + ((index * 7) % 13) / 10;
  return {
    date: date.toISOString().slice(0, 10),
    requests: Math.round(18 * factor),
    totals: {
      inputTokens: Math.round(420_000 * factor),
      cacheReadTokens: Math.round(2_200_000 * factor),
      cacheWriteTokens: Math.round(270_000 * factor),
      outputTokens: Math.round(115_000 * factor),
      costCny: Number((14.5 * factor).toFixed(2)),
    },
  };
});

const demoModelDaily: ModelDailyUsage[] = demoDaily.flatMap((item) => {
  const split = (ratio: number) => ({
    inputTokens: Math.round(item.totals.inputTokens * ratio),
    cacheReadTokens: Math.round(item.totals.cacheReadTokens * ratio),
    cacheWriteTokens: Math.round(item.totals.cacheWriteTokens * ratio),
    outputTokens: Math.round(item.totals.outputTokens * ratio),
    costCny: Number((item.totals.costCny * ratio).toFixed(2)),
  });
  return [
    {
      model: "claude-sonnet-4-6",
      provider: "Claude Code",
      date: item.date,
      requests: Math.round(item.requests * 0.68),
      totals: split(0.72),
    },
    {
      model: "mimo-v2.5-pro",
      provider: "MiMo Code",
      date: item.date,
      requests: Math.max(1, Math.round(item.requests * 0.32)),
      totals: { ...split(0.28), costCny: 0 },
    },
  ];
});

const demoReport: UsageReport = {
  sourceDir: "C:\\Users\\you\\.claude\\projects",
  filesScanned: 128,
  recordsCount: 824,
  dateMin: "2026-05-14",
  dateMax: "2026-06-12",
  totals: {
    inputTokens: 12_856_400,
    cacheReadTokens: 72_430_800,
    cacheWriteTokens: 8_220_500,
    outputTokens: 3_480_700,
    costCny: 428.62,
  },
  models: [
    {
      model: "claude-sonnet-4-6",
      provider: "Claude Code",
      requests: 487,
      priced: true,
      customPriced: false,
      price: { model: "claude-sonnet-4-6", input: 21.6, cacheRead: 2.16, cacheWrite: 27, output: 108 },
      totals: { inputTokens: 8_200_000, cacheReadTokens: 54_200_000, cacheWriteTokens: 5_600_000, outputTokens: 2_100_000, costCny: 312.45 },
    },
    {
      model: "mimo-v2.5-pro",
      provider: "MiMo Code",
      requests: 239,
      priced: false,
      customPriced: false,
      price: { model: "mimo-v2.5-pro", input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      totals: { inputTokens: 2_056_400, cacheReadTokens: 5_430_800, cacheWriteTokens: 1_220_500, outputTokens: 560_700, costCny: 0 },
    },
  ],
  daily: demoDaily,
  modelDaily: demoModelDaily,
  warnings: ["MiMo 或未知模型没有公开可核验的 token 单价，成本暂按 ¥0 计算。"],
};

function loadCustomPrices(): ModelPrice[] {
  try {
    const value = JSON.parse(localStorage.getItem(PRICE_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((price) => typeof price?.model === "string").map(normalizePrice);
  } catch {
    return [];
  }
}

function loadDisplaySettings(): DisplaySettings {
  try {
    const value = JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY) ?? "{}");
    const themes: Theme[] = ["midnight", "ocean", "light", "graphite", "forest", "paper"];
    return {
      theme: themes.includes(value.theme) ? value.theme : "midnight",
      fonts: normalizeFontSizes(value.fonts),
    };
  } catch {
    return { theme: "midnight", fonts: { ...DEFAULT_FONTS } };
  }
}

function normalizeFontSizes(value: Partial<FontRoleSizes> | undefined): FontRoleSizes {
  const size = (candidate: unknown, fallback: number) => Math.min(40, Math.max(8, Number(candidate) || fallback));
  return {
    pageTitle: size(value?.pageTitle, DEFAULT_FONTS.pageTitle),
    sectionTitle: size(value?.sectionTitle, DEFAULT_FONTS.sectionTitle),
    body: size(value?.body, DEFAULT_FONTS.body),
    secondary: size(value?.secondary, DEFAULT_FONTS.secondary),
    data: size(value?.data, DEFAULT_FONTS.data),
    table: size(value?.table, DEFAULT_FONTS.table),
    control: size(value?.control, DEFAULT_FONTS.control),
  };
}

function applyDisplaySettings() {
  document.documentElement.dataset.theme = displaySettings.theme;
  Object.entries(displaySettings.fonts).forEach(([role, size]) => {
    document.documentElement.style.setProperty(`--font-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, `${size}px`);
  });
}

function saveDisplaySettings() {
  localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(displaySettings));
  applyDisplaySettings();
}

function ensureSelectedTokenModel(report: UsageReport) {
  if (selectedTokenChartModel === "all") return;
  if (!report.models.some((model) => model.model === selectedTokenChartModel)) {
    selectedTokenChartModel = "all";
  }
}

function normalizePrice(price: Partial<ModelPrice> & { model: string }): ModelPrice {
  const number = (value: unknown) => Math.max(0, Number(value) || 0);
  return {
    model: price.model.trim(),
    input: number(price.input),
    cacheRead: number(price.cacheRead),
    cacheWrite: number(price.cacheWrite),
    output: number(price.output),
  };
}

function persistCustomPrices() {
  localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(customPrices));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]!);
}

const fmtTokens = (value: number) => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 1 : 2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return value.toLocaleString("zh-CN");
};
const fmtMoney = (value: number) => `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fullTokens = (value: number) => value.toLocaleString("zh-CN");
const fmtPercent = (value: number, total: number) => ((value / total) * 100).toFixed(2);
const priceValue = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4, useGrouping: false });
type ExportFormat = "csv" | "json";

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reportToCsv(report: UsageReport) {
  const rows: Array<Array<string | number>> = [["section", "date", "model", "provider", "requests", "inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens", "costCny"]];
  report.daily.forEach((item) => rows.push([
    "daily",
    item.date,
    "",
    "",
    item.requests,
    item.totals.inputTokens,
    item.totals.cacheReadTokens,
    item.totals.cacheWriteTokens,
    item.totals.outputTokens,
    item.totals.costCny.toFixed(4),
  ]));
  report.models.forEach((model) => rows.push([
    "model",
    "",
    model.model,
    model.provider,
    model.requests,
    model.totals.inputTokens,
    model.totals.cacheReadTokens,
    model.totals.cacheWriteTokens,
    model.totals.outputTokens,
    model.totals.costCny.toFixed(4),
  ]));
  report.modelDaily.forEach((item) => rows.push([
    "modelDaily",
    item.date,
    item.model,
    item.provider,
    item.requests,
    item.totals.inputTokens,
    item.totals.cacheReadTokens,
    item.totals.cacheWriteTokens,
    item.totals.outputTokens,
    item.totals.costCny.toFixed(4),
  ]));
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

async function exportCurrentReport(format: ExportFormat) {
  if (!currentReport) return;
  const contents = format === "json"
    ? JSON.stringify({ range: { from: currentFrom, to: currentTo }, report: currentReport }, null, 2)
    : reportToCsv(currentReport);
  const path = await invoke<string>("export_report", { format, contents });
  showToast(`已导出到 ${path}`);
}

function dateRange(days: number | null) {
  if (!days) return { from: null, to: null };
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days + 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

async function loadUsage(from = currentFrom, to = currentTo) {
  currentFrom = from;
  currentTo = to;
  app.classList.add("loading");
  try {
    const currentRequest = invoke<UsageReport>("scan_usage", { from, to, customPrices });
    const insightsRequest = from === null && to === null
      ? currentRequest
      : invoke<UsageReport>("scan_usage", { from: null, to: null, customPrices });
    const [usageReport, insightsReport] = await Promise.all([currentRequest, insightsRequest]);
    currentReport = usageReport;
    currentInsightsReport = insightsReport;
    render(currentReport);
  } catch (error) {
    console.warn("Tauri API unavailable, rendering preview data", error);
    currentReport = demoReport;
    currentInsightsReport = demoReport;
    render(demoReport, true);
  } finally {
    app.classList.remove("loading");
  }
}

function sidebar(report: UsageReport) {
  const nav = (page: Page, icon: string, label: string) =>
    `<button class="nav-item ${activePage === page ? "active" : ""}" data-page="${page}"><i class="nav-icon ${icon}"></i>${label}</button>`;
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><span></span><span></span><span></span></div>
        <div><strong>Token Ledger</strong><small>本地用量账本</small></div>
      </div>
      <p class="nav-label">分析与设置</p>
      <nav>
        ${nav("overview", "grid-icon", "总览")}
        ${nav("models", "model-icon", "模型用量")}
        ${nav("pricing", "price-icon", "价格说明")}
        ${nav("display", "display-icon", "显示设置")}
      </nav>
      <div class="source-card">
        <div class="source-title"><span class="status-dot"></span>本地扫描正常</div>
        <p title="${escapeHtml(report.sourceDir)}">${escapeHtml(report.sourceDir)}</p>
        <div><span>${report.filesScanned} 个日志</span><span>${report.recordsCount} 次调用</span></div>
      </div>
      <div class="privacy"><span>LOCAL ONLY</span><p>所有数据只在本机读取与计算，不上传任何会话内容。</p></div>
    </aside>`;
}

function pageHeader(title: string, eyebrow: string, subtitle: string, action = true) {
  const rangeLabel = currentFrom && currentTo
    ? `${currentFrom.replace(/-/g, ".")} - ${currentTo.replace(/-/g, ".")}`
    : "全部记录";
  return `
    <header>
      <div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>
      ${action ? `<div class="header-actions">
        <div class="range-display"><span>当前范围</span><strong>${rangeLabel}</strong></div>
        <div class="export-actions"><button class="export-btn" data-export-format="csv">导出 CSV</button><button class="export-btn" data-export-format="json">导出 JSON</button></div>
        <button class="refresh-btn" id="refresh-btn" title="重新扫描"><span>↻</span>刷新数据</button>
      </div>` : ""}
    </header>`;
}

function filterBar() {
  return `
    <section class="filter-bar">
      <div class="quick-ranges">
        <button data-days="7" class="${activeRange === "7" ? "active" : ""}">近 7 天</button>
        <button data-days="30" class="${activeRange === "30" ? "active" : ""}">近 30 天</button>
        <button data-days="all" class="${activeRange === "all" ? "active" : ""}">全部</button>
      </div>
      <div class="custom-range">
        <label>自定义日期</label>
        <input type="date" id="from-date" value="${currentFrom ?? ""}" />
        <span>至</span>
        <input type="date" id="to-date" value="${currentTo ?? ""}" />
        <button id="apply-range">应用</button>
      </div>
    </section>`;
}

function warningBar(report: UsageReport) {
  return report.warnings.length
    ? `<section class="warning"><span>i</span><p>${escapeHtml(report.warnings.join(" "))}</p></section>`
    : "";
}

function sparkline(daily: DailyUsage[]) {
  if (!daily.length) return `<div class="empty-chart">所选日期范围内暂无记录</div>`;
  const width = 760;
  const height = 220;
  const pad = 18;
  const values = daily.map((item) => item.totals.costCny);
  const max = Math.max(...values, 1);
  const pointList = daily.map((item, index) => {
    const x = pad + (index / Math.max(daily.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - (item.totals.costCny / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const points = pointList.join(" ");
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  const guides = [0.25, 0.5, 0.75].map((ratio) => `<line x1="${pad}" y1="${height * ratio}" x2="${width - pad}" y2="${height * ratio}" />`).join("");
  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="每日花销趋势图">
      <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8b7cff" stop-opacity=".42"/><stop offset="100%" stop-color="#8b7cff" stop-opacity="0"/></linearGradient></defs>
      <g class="guides">${guides}</g><polygon points="${area}" fill="url(#chartFill)"/>
      <polyline points="${points}" fill="none" stroke="#9d91ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${daily.map((item, index) => {
        const [x, y] = pointList[index].split(",");
        return `<circle cx="${x}" cy="${y}" r="3" data-tooltip-title="${fmtMoney(item.totals.costCny)}" data-tooltip-detail="${item.date}" />`;
      }).join("")}
    </svg>`;
}

function dailyTokenTotal(item: DailyUsage) {
  return item.totals.inputTokens + item.totals.cacheReadTokens + item.totals.cacheWriteTokens + item.totals.outputTokens;
}

function totalsTokenTotal(totals: Totals) {
  return totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens;
}

function cacheTokenTotal(totals: Totals) {
  return totals.cacheReadTokens + totals.cacheWriteTokens;
}

function sumDaily(daily: DailyUsage[]) {
  return daily.reduce((totals, item) => {
    totals.inputTokens += item.totals.inputTokens;
    totals.cacheReadTokens += item.totals.cacheReadTokens;
    totals.cacheWriteTokens += item.totals.cacheWriteTokens;
    totals.outputTokens += item.totals.outputTokens;
    totals.costCny += item.totals.costCny;
    return totals;
  }, { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costCny: 0 });
}

function changeLabel(current: number, previous: number) {
  if (previous <= 0) return "暂无基线";
  const change = ((current - previous) / previous) * 100;
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

function trendClass(current: number, previous: number) {
  if (previous <= 0) return "neutral";
  return current >= previous ? "up" : "down";
}

function periodComparison(daily: DailyUsage[], days: number) {
  const current = daily.slice(-days);
  const previous = daily.slice(Math.max(0, daily.length - days * 2), Math.max(0, daily.length - days));
  const currentTotals = sumDaily(current);
  const previousTotals = sumDaily(previous);
  return {
    currentTokens: totalsTokenTotal(currentTotals),
    previousTokens: totalsTokenTotal(previousTotals),
    currentCost: currentTotals.costCny,
    previousCost: previousTotals.costCny,
  };
}

function forecastFromDaily(daily: DailyUsage[], days: number) {
  const sample = daily.slice(-Math.min(7, daily.length));
  const totals = sumDaily(sample);
  const divisor = Math.max(sample.length, 1);
  return {
    tokens: Math.round((totalsTokenTotal(totals) / divisor) * days),
    cost: (totals.costCny / divisor) * days,
  };
}

function zeroDailyUsage(date: string): DailyUsage {
  return {
    date,
    requests: 0,
    totals: {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      costCny: 0,
    },
  };
}

function selectedModelDaily(report: UsageReport) {
  if (selectedTokenChartModel === "all") return report.daily;
  const byDate = new Map(
    report.modelDaily
      .filter((item) => item.model === selectedTokenChartModel)
      .map((item) => [item.date, item]),
  );
  return report.daily.map((item) => byDate.get(item.date) ?? zeroDailyUsage(item.date));
}

function selectedModelLabel(report: UsageReport) {
  if (selectedTokenChartModel === "all") return "全部模型";
  return report.models.find((model) => model.model === selectedTokenChartModel)?.model ?? "全部模型";
}

function tokenChartFilter(report: UsageReport) {
  return `
    <div class="token-chart-controls">
      <label class="model-filter"><span>展示模型</span><select id="token-model-filter">
        <option value="all" ${selectedTokenChartModel === "all" ? "selected" : ""}>全部模型</option>
        ${report.models.map((model) => `<option value="${escapeHtml(model.model)}" ${selectedTokenChartModel === model.model ? "selected" : ""}>${escapeHtml(model.model)}</option>`).join("")}
      </select></label>
      <div class="token-stack-legend" aria-label="Token 构成图例">
        <span><i class="stack-dot cache"></i>缓内</span>
        <span><i class="stack-dot input"></i>缓外</span>
        <span><i class="stack-dot output"></i>输出</span>
      </div>
    </div>`;
}

function tokenUsageChart(daily: DailyUsage[], modelLabel: string) {
  if (!daily.length) return `<div class="empty-chart">所选日期范围内暂无 Token 记录</div>`;
  const width = 1000;
  const height = 250;
  const pad = 24;
  const chartHeight = height - pad * 2;
  const chartWidth = width - pad * 2;
  const values = daily.map(dailyTokenTotal);
  const max = Math.max(...values, 1);
  const guides = [0.25, 0.5, 0.75].map((ratio) => `<line x1="${pad}" y1="${height * ratio}" x2="${width - pad}" y2="${height * ratio}" />`).join("");
  const slot = chartWidth / Math.max(daily.length, 1);
  const barWidth = Math.max(5, Math.min(30, slot * 0.58));
  const scale = (value: number) => (value / max) * chartHeight;
  const bars = daily.map((item, index) => {
    const totals = item.totals;
    const cache = cacheTokenTotal(totals);
    const input = totals.inputTokens;
    const output = totals.outputTokens;
    const total = dailyTokenTotal(item);
    const x = pad + index * slot + (slot - barWidth) / 2;
    const totalHeight = scale(total);
    const top = height - pad - totalHeight;
    const cacheHeight = scale(cache);
    const inputHeight = scale(input);
    const outputHeight = scale(output);
    const inputY = top + cacheHeight;
    const outputY = inputY + inputHeight;
    const detail = `${item.date} · ${modelLabel} · 缓内 ${fmtTokens(cache)} · 缓外 ${fmtTokens(input)} · 输出 ${fmtTokens(output)}`;
    const title = `${fmtTokens(total)} Token`;
    return `
      <g class="token-stack-bar" data-tooltip-title="${escapeHtml(title)}" data-tooltip-detail="${escapeHtml(detail)}">
        <rect class="stack-hit" x="${x.toFixed(1)}" y="${pad}" width="${barWidth.toFixed(1)}" height="${chartHeight}" />
        <rect class="token-segment cache" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${cacheHeight.toFixed(1)}" />
        <rect class="token-segment input" x="${x.toFixed(1)}" y="${inputY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${inputHeight.toFixed(1)}" />
        <rect class="token-segment output" x="${x.toFixed(1)}" y="${outputY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${outputHeight.toFixed(1)}" />
      </g>`;
  }).join("");
  return `
    <svg class="trend-svg token-trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="选定日期范围内每日 Token 用量图">
      <g class="guides">${guides}</g>
      ${bars}
    </svg>`;
}

function metricGrid(report: UsageReport) {
  const t = report.totals;
  const cacheTotal = t.cacheReadTokens + t.cacheWriteTokens;
  const allTokens = t.inputTokens + cacheTotal + t.outputTokens || 1;
  const cachePercent = fmtPercent(cacheTotal, allTokens);
  const pricedModels = report.models.filter((model) => model.priced).length;
  return `
    <section class="metric-grid">
      <article class="metric-card cost-card"><div class="metric-top"><span class="metric-icon cost">¥</span><span class="tag">API 等价成本</span></div><p>预估花销</p><strong>${fmtMoney(t.costCny)}</strong><div class="metric-foot"><span>${pricedModels} 个已定价模型</span><span>按 ¥${USD_TO_CNY_TEXT}/USD</span></div></article>
      <article class="metric-card input-card"><div class="metric-top"><span class="metric-icon input">↘</span><span class="tag subtle">非缓存</span></div><p>缓外输入</p><strong>${fmtTokens(t.inputTokens)}</strong><div class="metric-foot"><span>${fullTokens(t.inputTokens)} tokens</span></div></article>
      <article class="metric-card cache-card"><div class="metric-top"><span class="metric-icon cache">⌁</span><span class="tag good">${cachePercent}% 占比</span></div><p>缓内输入</p><strong>${fmtTokens(cacheTotal)}</strong><div class="metric-foot split"><span>读取 ${fmtTokens(t.cacheReadTokens)}</span><span>写入 ${fmtTokens(t.cacheWriteTokens)}</span></div></article>
      <article class="metric-card output-card"><div class="metric-top"><span class="metric-icon output">↗</span><span class="tag subtle">生成</span></div><p>输出</p><strong>${fmtTokens(t.outputTokens)}</strong><div class="metric-foot"><span>${fullTokens(t.outputTokens)} tokens</span></div></article>
    </section>`;
}

function analysisInsights(report: UsageReport) {
  const weekly = periodComparison(report.daily, 7);
  const monthly = periodComparison(report.daily, 30);
  const next7 = forecastFromDaily(report.daily, 7);
  const next30 = forecastFromDaily(report.daily, 30);
  return `
    <section class="insight-grid">
      <article class="panel insight-card"><p class="panel-kicker">WEEKLY CHANGE</p><h2>近 7 天环比</h2><strong>${fmtTokens(weekly.currentTokens)} Token</strong><span class="trend-badge ${trendClass(weekly.currentTokens, weekly.previousTokens)}">${changeLabel(weekly.currentTokens, weekly.previousTokens)}</span><p>对比前 7 天 · 当前 ${fmtMoney(weekly.currentCost)} / 前期 ${fmtMoney(weekly.previousCost)}</p></article>
      <article class="panel insight-card"><p class="panel-kicker">MONTHLY CHANGE</p><h2>近 30 天环比</h2><strong>${fmtTokens(monthly.currentTokens)} Token</strong><span class="trend-badge ${trendClass(monthly.currentTokens, monthly.previousTokens)}">${changeLabel(monthly.currentTokens, monthly.previousTokens)}</span><p>对比前 30 天 · 当前 ${fmtMoney(monthly.currentCost)} / 前期 ${fmtMoney(monthly.previousCost)}</p></article>
      <article class="panel insight-card"><p class="panel-kicker">FORECAST 7D</p><h2>未来 7 天预测</h2><strong>${fmtTokens(next7.tokens)} Token</strong><span>${fmtMoney(next7.cost)}</span><p>基于最近 ${Math.min(7, report.daily.length)} 天平均消耗估算</p></article>
      <article class="panel insight-card"><p class="panel-kicker">FORECAST 30D</p><h2>未来 30 天预测</h2><strong>${fmtTokens(next30.tokens)} Token</strong><span>${fmtMoney(next30.cost)}</span><p>用于预估本月后续预算压力</p></article>
    </section>`;
}

function modelTable(models: ModelUsage[]) {
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>模型</th><th>调用</th><th>缓外输入</th><th>缓内读取</th><th>缓内写入</th><th>输出</th><th class="money">预估花销</th></tr></thead>
      <tbody>${models.length ? models.map((model, index) => `
        <tr><td><div class="model-name"><span class="model-avatar color-${index % 4}">${model.provider === "MiMo Code" ? "M" : "C"}</span><p><strong>${escapeHtml(model.model)}</strong><small>${escapeHtml(model.provider)} · ${model.customPriced ? "自定义价格" : model.priced ? "内置价格" : "未定价"}</small></p></div></td>
        <td>${model.requests.toLocaleString("zh-CN")}</td><td>${fmtTokens(model.totals.inputTokens)}</td><td>${fmtTokens(model.totals.cacheReadTokens)}</td><td>${fmtTokens(model.totals.cacheWriteTokens)}</td><td>${fmtTokens(model.totals.outputTokens)}</td>
        <td class="money"><strong>${model.priced ? fmtMoney(model.totals.costCny) : "—"}</strong></td></tr>`).join("") : `<tr><td colspan="7" class="empty-row">所选日期范围内暂无使用记录</td></tr>`}</tbody>
    </table></div>`;
}

function filteredModels(models: ModelUsage[]) {
  const search = modelSearch.trim().toLowerCase();
  return models.filter((model) => {
    const matchesSearch = !search
      || model.model.toLowerCase().includes(search)
      || model.provider.toLowerCase().includes(search);
    const matchesProvider = modelProviderFilter === "all" || model.provider === modelProviderFilter;
    return matchesSearch && matchesProvider;
  });
}

function modelListControls(report: UsageReport, filteredCount: number) {
  const providers = Array.from(new Set(report.models.map((model) => model.provider))).sort();
  return `
    <section class="panel model-filter-panel">
      <div><p class="panel-kicker">FILTER MODELS</p><h2>模型搜索与筛选</h2><span>${filteredCount} / ${report.models.length} 个模型匹配</span></div>
      <div class="model-list-controls">
        <input id="model-search" type="text" placeholder="搜索模型名或 Provider" value="${escapeHtml(modelSearch)}" />
        <select id="model-provider-filter">
          <option value="all" ${modelProviderFilter === "all" ? "selected" : ""}>全部 Provider</option>
          ${providers.map((provider) => `<option value="${escapeHtml(provider)}" ${modelProviderFilter === provider ? "selected" : ""}>${escapeHtml(provider)}</option>`).join("")}
        </select>
      </div>
    </section>`;
}

function overviewPage(report: UsageReport) {
  const insightsReport = currentInsightsReport ?? report;
  const t = report.totals;
  const cacheTotal = t.cacheReadTokens + t.cacheWriteTokens;
  const allTokens = t.inputTokens + cacheTotal + t.outputTokens || 1;
  const cachePercent = fmtPercent(cacheTotal, allTokens);
  return `
    ${pageHeader("Token 消耗总览", "USAGE OVERVIEW", "Claude Code 与 MiMo Code 的模型用量和预估成本")}
    ${filterBar()}${warningBar(report)}${metricGrid(report)}${analysisInsights(insightsReport)}
    <section class="dashboard-grid">
      <article class="panel trend-panel"><div class="panel-head"><div><p class="panel-kicker">SPEND TREND</p><h2>每日预估花销</h2></div><div class="legend"><span></span>人民币 / 天</div></div><div class="chart-wrap">${sparkline(report.daily)}</div><div class="chart-axis"><span>${report.daily[0]?.date.slice(5) ?? "--"}</span><span>${report.daily[report.daily.length - 1]?.date.slice(5) ?? "--"}</span></div></article>
      <article class="panel composition-panel"><div class="panel-head"><div><p class="panel-kicker">COMPOSITION</p><h2>Token 构成</h2></div></div><div class="donut-wrap"><div class="donut" style="--input:${(t.inputTokens / allTokens) * 100}%;--cache:${((t.inputTokens + cacheTotal) / allTokens) * 100}%"><div><strong>${fmtTokens(allTokens)}</strong><span>总 Token</span></div></div><div class="donut-legend"><div><span class="dot input-dot"></span><p>缓外输入<small>${fmtPercent(t.inputTokens, allTokens)}%</small></p></div><div><span class="dot cache-dot"></span><p>缓内输入<small>${cachePercent}%</small></p></div><div><span class="dot output-dot"></span><p>输出<small>${fmtPercent(t.outputTokens, allTokens)}%</small></p></div></div></div></article>
    </section>
    <section class="panel models-panel"><div class="panel-head"><div><p class="panel-kicker">TOP MODELS</p><h2>主要模型</h2></div><button class="text-button" data-page="models">查看完整分析 →</button></div>${modelTable(report.models.slice(0, 5))}</section>`;
}

function modelsPage(report: UsageReport) {
  const maxCost = Math.max(...report.models.map((model) => model.totals.costCny), 1);
  const chartDaily = selectedModelDaily(report);
  const chartLabel = selectedModelLabel(report);
  const visibleModels = filteredModels(report.models);
  return `
    ${pageHeader("模型用量", "MODEL ANALYTICS", "逐模型查看调用量、Token 构成与成本")}
    ${filterBar()}${warningBar(report)}${metricGrid(report)}
    <section class="panel token-trend-panel"><div class="panel-head token-chart-head"><div><p class="panel-kicker">TOKEN TREND</p><h2>每日 Token 用量</h2><span class="token-chart-summary">${escapeHtml(chartLabel)} · 堆叠显示缓内 / 缓外 / 输出</span></div>${tokenChartFilter(report)}</div><div class="chart-wrap token-chart-wrap">${tokenUsageChart(chartDaily, chartLabel)}</div><div class="chart-axis"><span>${report.daily[0]?.date.slice(5) ?? "--"}</span><span>${report.daily[report.daily.length - 1]?.date.slice(5) ?? "--"}</span></div></section>
    ${modelListControls(report, visibleModels.length)}
    <section class="model-card-grid">${visibleModels.map((model, index) => `
      <article class="model-stat-card"><div class="model-stat-head"><span class="model-avatar color-${index % 4}">${model.provider === "MiMo Code" ? "M" : "C"}</span><div><strong>${escapeHtml(model.model)}</strong><small>${escapeHtml(model.provider)}</small></div><span class="price-source ${model.customPriced ? "custom" : ""}">${model.customPriced ? "自定义" : model.priced ? "内置价格" : "未定价"}</span></div>
      <div class="model-stat-cost">${model.priced ? fmtMoney(model.totals.costCny) : "—"}<small>${model.requests} 次调用</small></div>
      <div class="cost-bar"><span style="width:${model.priced ? Math.max(2, model.totals.costCny / maxCost * 100) : 0}%"></span></div>
      <div class="model-stat-foot"><span>输入 ${fmtTokens(model.totals.inputTokens + model.totals.cacheReadTokens + model.totals.cacheWriteTokens)}</span><span>输出 ${fmtTokens(model.totals.outputTokens)}</span></div></article>`).join("") || `<div class="empty-row">所选日期范围内暂无模型记录</div>`}</section>
    <section class="panel models-panel"><div class="panel-head"><div><p class="panel-kicker">ALL MODELS</p><h2>完整模型明细</h2></div><span class="model-count">${visibleModels.length} / ${report.models.length} 个模型</span></div>${modelTable(visibleModels)}</section>`;
}

function pricingRows(report: UsageReport) {
  const detected = new Map(report.models.map((model) => [model.model.toLowerCase(), model]));
  const rows: Array<{ model: string; provider: string; customPriced: boolean; priced: boolean; price: ModelPrice; detected: boolean }> =
    report.models.map((model) => ({ ...model, detected: true }));
  customPrices.forEach((price) => {
    if (!detected.has(price.model.toLowerCase())) {
      rows.push({
        model: price.model,
        provider: price.model.toLowerCase().includes("mimo") ? "MiMo Code" : "自定义模型",
        customPriced: true,
        priced: price.input + price.cacheRead + price.cacheWrite + price.output > 0,
        price,
        detected: false,
      });
    }
  });
  return rows;
}

function pricingPage(report: UsageReport) {
  const rows = pricingRows(report);
  return `
    ${pageHeader("价格说明", "PRICE SETTINGS", "自定义每百万 Token 的人民币单价，保存后所有统计立即重算", false)}
    <section class="price-intro-grid">
      <article class="panel price-intro"><span class="intro-icon">¥</span><div><h2>价格单位</h2><p>下方所有单价均为人民币 / 百万 Token（CNY / MTok）。</p></div></article>
      <article class="panel price-intro"><span class="intro-icon purple">◎</span><div><h2>匹配方式</h2><p>自定义价格按完整模型名匹配，不会影响其他相似模型。</p></div></article>
      <article class="panel price-intro"><span class="intro-icon green">✓</span><div><h2>本地持久化</h2><p>价格只保存在本机 WebView 数据中，免安装版重启后仍保留。</p></div></article>
    </section>
    <section class="panel add-price-panel"><div><p class="panel-kicker">ADD MODEL</p><h2>添加自定义模型</h2></div><div class="add-model-form"><input id="new-model-name" type="text" placeholder="例如 mimo-v2.5-pro" /><button id="add-model-price">添加价格项</button></div></section>
    <section class="panel pricing-panel"><div class="panel-head"><div><p class="panel-kicker">MODEL PRICES</p><h2>模型单价</h2></div><span class="model-count">${rows.length} 个价格项</span></div>
      <div class="price-list">${rows.map((row, index) => {
        const custom = customPrices.find((price) => price.model.toLowerCase() === row.model.toLowerCase());
        const price = custom ?? row.price;
        return `<article class="price-row" data-price-row="${escapeHtml(row.model)}">
          <div class="price-model"><span class="model-avatar color-${index % 4}">${row.provider === "MiMo Code" ? "M" : "C"}</span><div><strong>${escapeHtml(row.model)}</strong><small>${escapeHtml(row.provider)} · ${row.customPriced ? "正在使用自定义价格" : row.priced ? "正在使用内置价格" : "等待设置价格"}${row.detected ? "" : " · 当前范围未检测到"}</small></div></div>
          ${priceInput("缓外输入", "input", price.input)}${priceInput("缓内读取", "cacheRead", price.cacheRead)}${priceInput("缓内写入", "cacheWrite", price.cacheWrite)}${priceInput("输出", "output", price.output)}
          <div class="price-actions"><button class="save-price" data-model="${escapeHtml(row.model)}">保存</button>${row.customPriced ? `<button class="reset-price" data-model="${escapeHtml(row.model)}">${row.detected ? "恢复默认" : "删除"}</button>` : ""}</div>
        </article>`;
      }).join("") || `<div class="empty-row">尚未检测到模型，可在上方手动添加。</div>`}</div>
    </section>
    <section class="panel price-notes"><h2>内置价格说明</h2><p>Claude 模型使用公开 API 价格，并按 1 USD = ${USD_TO_CNY_TEXT} CNY 换算。MiMo 与未知模型默认未定价；为它们保存自定义价格后，总览、每日趋势和模型用量会自动重新计算。</p></section>`;
}

function priceInput(label: string, field: keyof Omit<ModelPrice, "model">, value: number) {
  return `<label class="price-field"><span>${label}</span><div><b>¥</b><input type="number" min="0" step="0.0001" data-price-field="${field}" value="${priceValue(value)}" /></div></label>`;
}

function displayPage() {
  const themeCard = (theme: Theme, title: string, subtitle: string, swatches: string[]) => `
    <button class="theme-card ${displaySettings.theme === theme ? "active" : ""}" data-theme-option="${theme}">
      <div class="theme-preview theme-preview-${theme}">
        <span class="preview-sidebar"></span>
        <span class="preview-card one"></span><span class="preview-card two"></span>
        <span class="preview-line"></span>
      </div>
      <div class="theme-card-copy"><strong>${title}</strong><small>${subtitle}</small></div>
      <div class="theme-swatches">${swatches.map((color) => `<span style="background:${color}"></span>`).join("")}</div>
      <i class="selection-check">✓</i>
    </button>`;
  const fontRoleInput = (role: keyof FontRoleSizes, label: string, description: string, sampleClass: string) => `
    <label class="font-role-row">
      <span class="font-role-sample ${sampleClass}">Aa</span>
      <span class="font-role-copy"><strong>${label}</strong><small>${description}</small></span>
      <span class="font-px-input"><input type="number" min="8" max="40" step="1" value="${displaySettings.fonts[role]}" data-font-role="${role}" /><b>px</b></span>
    </label>`;

  return `
    ${pageHeader("显示设置", "APPEARANCE", "调整应用主题和整体阅读尺度，设置会自动保存在本机", false)}
    <section class="panel settings-section">
      <div class="settings-head"><div><p class="panel-kicker">THEME</p><h2>界面主题</h2><span>选择更适合当前环境的配色方案</span></div></div>
      <div class="theme-grid">
        ${themeCard("midnight", "午夜紫", "清晰克制的默认深色主题", ["#090b10", "#9589f7", "#63c9a4"])}
        ${themeCard("ocean", "深海蓝", "高对比低饱和冷色主题", ["#061117", "#63b5dc", "#66c9b5"])}
        ${themeCard("light", "云雾白", "冷静明亮的高可读主题", ["#eef1f5", "#6558c4", "#347e68"])}
        ${themeCard("graphite", "石墨橙", "中性炭黑与暖色强调", ["#11100f", "#d99a5b", "#68b99b"])}
        ${themeCard("forest", "松林绿", "沉静低饱和绿色主题", ["#07130f", "#58b590", "#d0a46b"])}
        ${themeCard("paper", "暖纸白", "柔和纸张与墨色主题", ["#f4efe6", "#a85f45", "#397d68"])}
      </div>
    </section>
    <section class="panel settings-section">
      <div class="settings-head"><div><p class="panel-kicker">TYPOGRAPHY</p><h2>语义字体大小</h2><span>为不同信息层级指定具体 px 数值，允许范围为 8–40px</span></div><button id="reset-display" class="reset-display">恢复默认</button></div>
      <div class="font-role-grid">
        ${fontRoleInput("pageTitle", "页面标题", "每个页面顶部的主标题", "sample-page-title")}
        ${fontRoleInput("sectionTitle", "区块标题", "卡片、面板和设置项标题", "sample-section-title")}
        ${fontRoleInput("body", "一般正文", "说明文字、图表提示主数据与普通内容", "sample-body")}
        ${fontRoleInput("secondary", "辅助文字", "注释、图表提示明细、状态与次要信息", "sample-secondary")}
        ${fontRoleInput("data", "关键数字", "总花销、Token 指标等核心数据", "sample-data")}
        ${fontRoleInput("table", "表格文字", "模型明细表和价格表内容", "sample-table")}
        ${fontRoleInput("control", "按钮与导航", "侧边栏、筛选器、按钮和输入框", "sample-control")}
      </div>
      <div class="font-demo">
        <div><p class="panel-kicker">LIVE PREVIEW</p><h2>实时预览</h2></div>
        <div class="font-demo-value"><strong>¥428.62</strong><span>预估花销 · 12.8M Token</span></div>
        <p>Claude Code 与 MiMo Code 的模型用量和预估成本</p>
      </div>
    </section>
    <section class="panel display-note"><span>i</span><p>修改数值后会立即应用并自动保存。显示设置不会改变日志扫描、Token 统计或模型价格。</p></section>`;
}

function footer(preview: boolean) {
  return `<footer><span>${preview ? "预览模式 · " : ""}价格为 API 等价成本估算，并不代表订阅账单</span><span>最后扫描：刚刚</span></footer>`;
}

function render(report: UsageReport, preview = false) {
  ensureSelectedTokenModel(report);
  const content = activePage === "overview"
    ? overviewPage(report)
    : activePage === "models"
      ? modelsPage(report)
      : activePage === "pricing"
        ? pricingPage(report)
        : displayPage();
  app.innerHTML = `${sidebar(report)}<main>${content}${footer(preview)}</main><div id="tooltip" class="tooltip"></div><div id="toast" class="toast"></div>`;
  bindEvents();
}

function showToast(message: string) {
  const toast = document.querySelector<HTMLDivElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      activePage = button.dataset.page as Page;
      if (currentReport) render(currentReport);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-theme-option]").forEach((button) => {
    button.addEventListener("click", () => {
      displaySettings.theme = button.dataset.themeOption as Theme;
      saveDisplaySettings();
      if (currentReport) render(currentReport);
    });
  });
  document.querySelectorAll<HTMLInputElement>("[data-font-role]").forEach((input) => {
    input.addEventListener("input", () => {
      const role = input.dataset.fontRole as keyof FontRoleSizes;
      displaySettings.fonts[role] = normalizeFontSizes({ [role]: input.value } as Partial<FontRoleSizes>)[role];
      saveDisplaySettings();
    });
    input.addEventListener("change", () => {
      const role = input.dataset.fontRole as keyof FontRoleSizes;
      input.value = String(displaySettings.fonts[role]);
    });
  });
  document.querySelector("#reset-display")?.addEventListener("click", () => {
    displaySettings = { theme: "midnight", fonts: { ...DEFAULT_FONTS } };
    saveDisplaySettings();
    if (currentReport) render(currentReport);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-days]").forEach((button) => {
    button.addEventListener("click", () => {
      activeRange = button.dataset.days!;
      const range = activeRange === "all" ? { from: null, to: null } : dateRange(Number(activeRange));
      loadUsage(range.from, range.to);
    });
  });
  document.querySelector("#apply-range")?.addEventListener("click", () => {
    activeRange = "custom";
    loadUsage(document.querySelector<HTMLInputElement>("#from-date")?.value || null, document.querySelector<HTMLInputElement>("#to-date")?.value || null);
  });
  document.querySelector("#refresh-btn")?.addEventListener("click", () => loadUsage());
  document.querySelectorAll<HTMLButtonElement>("[data-export-format]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await exportCurrentReport(button.dataset.exportFormat as ExportFormat);
      } catch (error) {
        showToast(`导出失败：${String(error)}`);
      }
    });
  });
  document.querySelector<HTMLSelectElement>("#token-model-filter")?.addEventListener("change", (event) => {
    selectedTokenChartModel = (event.currentTarget as HTMLSelectElement).value;
    if (currentReport) render(currentReport);
  });
  document.querySelector<HTMLInputElement>("#model-search")?.addEventListener("input", (event) => {
    modelSearch = (event.currentTarget as HTMLInputElement).value;
    if (currentReport) render(currentReport);
    document.querySelector<HTMLInputElement>("#model-search")?.focus();
  });
  document.querySelector<HTMLSelectElement>("#model-provider-filter")?.addEventListener("change", (event) => {
    modelProviderFilter = (event.currentTarget as HTMLSelectElement).value;
    if (currentReport) render(currentReport);
  });
  document.querySelector("#add-model-price")?.addEventListener("click", () => {
    const input = document.querySelector<HTMLInputElement>("#new-model-name");
    const model = input?.value.trim() ?? "";
    if (!model) return showToast("请输入模型名称");
    if (!customPrices.some((price) => price.model.toLowerCase() === model.toLowerCase())) {
      customPrices.push({ model, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
      persistCustomPrices();
    }
    if (currentReport) render(currentReport);
  });
  document.querySelectorAll<HTMLButtonElement>(".save-price").forEach((button) => {
    button.addEventListener("click", async () => {
      const model = button.dataset.model!;
      const row = button.closest<HTMLElement>("[data-price-row]");
      if (!row) return;
      const read = (field: string) => Number(row.querySelector<HTMLInputElement>(`[data-price-field="${field}"]`)?.value) || 0;
      const price = normalizePrice({ model, input: read("input"), cacheRead: read("cacheRead"), cacheWrite: read("cacheWrite"), output: read("output") });
      customPrices = customPrices.filter((item) => item.model.toLowerCase() !== model.toLowerCase());
      customPrices.push(price);
      persistCustomPrices();
      await loadUsage();
      showToast(`${model} 的自定义价格已保存`);
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".reset-price").forEach((button) => {
    button.addEventListener("click", async () => {
      const model = button.dataset.model!;
      customPrices = customPrices.filter((item) => item.model.toLowerCase() !== model.toLowerCase());
      persistCustomPrices();
      await loadUsage();
      showToast(`${model} 已恢复默认价格`);
    });
  });

  const tooltip = document.querySelector<HTMLDivElement>("#tooltip");
  document.querySelectorAll<SVGElement>(".trend-svg [data-tooltip-title]").forEach((chartItem) => {
    chartItem.addEventListener("mouseenter", () => {
      if (!tooltip) return;
      tooltip.innerHTML = `<strong>${chartItem.getAttribute("data-tooltip-title") ?? ""}</strong><span>${chartItem.getAttribute("data-tooltip-detail") ?? ""}</span>`;
      tooltip.classList.add("show");
    });
    chartItem.addEventListener("mousemove", (event) => {
      if (!tooltip) return;
      tooltip.style.left = `${event.clientX + 12}px`;
      tooltip.style.top = `${event.clientY - 18}px`;
    });
    chartItem.addEventListener("mouseleave", () => tooltip?.classList.remove("show"));
  });
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("input, textarea, select");
}

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  const pages: Page[] = ["overview", "models", "pricing", "display"];
  if (/^[1-4]$/.test(event.key)) {
    activePage = pages[Number(event.key) - 1];
    if (currentReport) render(currentReport);
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    loadUsage();
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    if (activePage !== "models") {
      activePage = "models";
      if (currentReport) render(currentReport);
    }
    document.querySelector<HTMLInputElement>("#model-search")?.focus();
  }
});

const initialRange = dateRange(30);
loadUsage(initialRange.from, initialRange.to);
