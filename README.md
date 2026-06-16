# Token Ledger

一个本地运行的 Windows 桌面应用，用于汇总 Claude Code CLI 与 MiMo Code CLI 的 token 消耗。

## 功能

- 扫描 `%USERPROFILE%\.claude\projects\**\*.jsonl`
- 只读扫描 `%USERPROFILE%\.local\share\mimocode\mimocode.db`，并排除 MiMo 已导入的 Claude 消息，避免重复统计
- 按模型分类统计 Claude Code 与 MiMo Code
- 展示缓外输入、缓内读取、缓内写入、输出和调用次数
- Token 构成占比显示至小数点后两位
- 模型完整分析页展示选定日期范围内的每日 Token 堆叠柱状图，并可按模型筛选
- 总览页展示近 7/30 天环比和未来 7/30 天用量、成本预测
- 支持近 7 天、近 30 天、全部记录与自定义日期范围
- 支持将当前筛选范围导出为 CSV 或 JSON 文件
- 按公开 API 价格估算人民币成本
- 独立的模型用量分析页与价格说明页
- 模型用量页支持按模型名和 Provider 搜索筛选
- 支持 `1/2/3/4` 页面切换、`Ctrl+R` 刷新、`Ctrl+F` 聚焦模型搜索
- 支持按完整模型名自定义人民币 / 百万 Token 单价，并在本机持久化
- 支持午夜紫、深海蓝、云雾白、石墨橙、松林绿、暖纸白主题
- 支持分别设置页面标题、区块标题、正文、辅助文字、关键数字、表格、按钮与导航的具体 px 字号
- 图表悬停提示的主数据与明细分别跟随正文、辅助文字字号设置
- 使用 Open Design 的 Precision Ledger 视觉体系，强化数据层级、图表和表格可读性
- 数据只在本机读取和计算

## 开发

```powershell
npm.cmd install
npm.cmd run tauri dev
```

## 构建 Windows 安装包

```powershell
npm.cmd run tauri build
```

Claude 成本按照 Anthropic 公开 API 价格和 `1 USD = 7.20 CNY` 估算。MiMo 当前未发现公开可核验的 token 单价，因此默认不计成本。
