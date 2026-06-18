# Token Ledger

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-blue.svg)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3.4-green.svg)](https://vuejs.org)

> A local-first Windows desktop app for tracking and analyzing token usage from Claude Code CLI and MiMo Code CLI.

## Features

- **Multi-source scanning** — reads Claude JSONL logs and MiMo SQLite database, deduplicates automatically
- **Model breakdown** — shows cache reads, cache writes, output tokens, and call counts per model
- **Cost estimation** — calculates CNY cost based on public API pricing (USD → CNY @ 7.20)
- **Trend analysis** — daily stacked bar charts with 7/30-day comparison and future cost predictions
- **CSV / JSON export** — export filtered data for external analysis
- **Search & filter** — quick filter by model name and provider
- **Keyboard shortcuts** — `1/2/3/4` page switch, `Ctrl+R` refresh, `Ctrl+F` search
- **Custom pricing** — set your own per-model price in CNY / million tokens, persisted locally
- **6 themes** — Midnight Purple, Deep Sea Blue, Cloud White, Graphite Orange, Pine Green, Warm Paper
- **Granular font sizing** — independently adjust titles, body text, key numbers, table cells, and chart tooltips
- **Privacy-first** — all data processed locally, never leaves your machine

## Screenshots

| Overview | Model Analysis | Price Reference |
|----------|----------------|-----------------|
| TODO     | TODO           | TODO            |

## Tech Stack

- [Tauri v2](https://tauri.app) — Rust backend for file I/O and SQLite
- [Vue 3](https://vuejs.org) + TypeScript
- [Vite](https://vitejs.dev) — fast dev & build
- [Vitest](https://vitest.dev) — unit testing

## Development

```bash
# Install dependencies
npm install

# Run in dev mode
npm run tauri dev
```

## Build

```bash
# Build Windows installer
npm run tauri build
```

## Data Sources

| Source | Path | Format |
|--------|------|--------|
| Claude Code | `%USERPROFILE%\.claude\projects\**\*.jsonl` | JSONL |
| MiMo Code | `%USERPROFILE%\.local\share\mimocode\mimocode.db` | SQLite (read-only) |

## License

[MIT](./LICENSE) © 2026 HaowenCang
