use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    env,
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const USD_TO_CNY: f64 = 7.2;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    input_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    output_tokens: u64,
    cost_cny: f64,
}

impl Totals {
    fn add(&mut self, other: &Totals) {
        self.input_tokens += other.input_tokens;
        self.cache_read_tokens += other.cache_read_tokens;
        self.cache_write_tokens += other.cache_write_tokens;
        self.output_tokens += other.output_tokens;
        self.cost_cny += other.cost_cny;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelUsage {
    model: String,
    provider: String,
    requests: u64,
    priced: bool,
    custom_priced: bool,
    price: ModelPrice,
    totals: Totals,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DailyUsage {
    date: String,
    requests: u64,
    totals: Totals,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDailyUsage {
    model: String,
    provider: String,
    date: String,
    requests: u64,
    totals: Totals,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageReport {
    source_dir: String,
    files_scanned: u64,
    records_count: u64,
    date_min: Option<String>,
    date_max: Option<String>,
    totals: Totals,
    models: Vec<ModelUsage>,
    daily: Vec<DailyUsage>,
    model_daily: Vec<ModelDailyUsage>,
    warnings: Vec<String>,
}

#[derive(Default)]
struct UsageAccumulator {
    seen_messages: HashSet<String>,
    totals: Totals,
    models: HashMap<String, ModelUsage>,
    daily: HashMap<String, DailyUsage>,
    model_daily: HashMap<String, ModelDailyUsage>,
    records_count: u64,
}

impl UsageAccumulator {
    fn add_record(
        &mut self,
        model: &str,
        date: &str,
        message_id: &str,
        usage: &Value,
        custom_prices: &[ModelPrice],
    ) {
        let (price, custom_priced) = price_for(model, custom_prices);
        let record_totals = record_totals(usage, &price);
        let token_sum = record_totals.input_tokens
            + record_totals.cache_read_tokens
            + record_totals.cache_write_tokens
            + record_totals.output_tokens;
        if token_sum == 0 {
            return;
        }
        if !message_id.is_empty() && !self.seen_messages.insert(message_id.to_string()) {
            return;
        }

        self.records_count += 1;
        self.totals.add(&record_totals);

        let model_usage = self
            .models
            .entry(model.to_string())
            .or_insert_with(|| ModelUsage {
                model: model.to_string(),
                provider: provider_for(model).to_string(),
                requests: 0,
                priced: price.is_priced(),
                custom_priced,
                price: price.clone(),
                totals: Totals::default(),
            });
        model_usage.requests += 1;
        model_usage.totals.add(&record_totals);

        let daily_usage = self
            .daily
            .entry(date.to_string())
            .or_insert_with(|| DailyUsage {
                date: date.to_string(),
                requests: 0,
                totals: Totals::default(),
            });
        daily_usage.requests += 1;
        daily_usage.totals.add(&record_totals);

        let model_daily_key = format!("{model}\u{1f}{date}");
        let model_daily_usage =
            self.model_daily
                .entry(model_daily_key)
                .or_insert_with(|| ModelDailyUsage {
                    model: model.to_string(),
                    provider: provider_for(model).to_string(),
                    date: date.to_string(),
                    requests: 0,
                    totals: Totals::default(),
                });
        model_daily_usage.requests += 1;
        model_daily_usage.totals.add(&record_totals);
    }
}

#[derive(Debug, Clone, Default, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelPrice {
    model: String,
    input: f64,
    cache_read: f64,
    cache_write: f64,
    output: f64,
}

impl ModelPrice {
    fn is_priced(&self) -> bool {
        self.input > 0.0 || self.cache_read > 0.0 || self.cache_write > 0.0 || self.output > 0.0
    }
}

fn default_price_for(model: &str) -> ModelPrice {
    let model = model.to_ascii_lowercase();
    let usd = |input: f64, cache_read: f64, cache_write: f64, output: f64| ModelPrice {
        model: model.clone(),
        input: input * USD_TO_CNY,
        cache_read: cache_read * USD_TO_CNY,
        cache_write: cache_write * USD_TO_CNY,
        output: output * USD_TO_CNY,
    };

    if model.contains("mimo") {
        ModelPrice {
            model,
            input: 0.0,
            cache_read: 0.0,
            cache_write: 0.0,
            output: 0.0,
        }
    } else if model.contains("fable") || model.contains("mythos") {
        usd(10.0, 1.0, 12.5, 50.0)
    } else if model.contains("opus-4-8")
        || model.contains("opus-4-7")
        || model.contains("opus-4-6")
        || model.contains("opus-4-5")
    {
        usd(5.0, 0.5, 6.25, 25.0)
    } else if model.contains("opus") {
        usd(15.0, 1.5, 18.75, 75.0)
    } else if model.contains("sonnet") {
        usd(3.0, 0.3, 3.75, 15.0)
    } else if model.contains("haiku") {
        usd(1.0, 0.1, 1.25, 5.0)
    } else {
        ModelPrice {
            model,
            input: 0.0,
            cache_read: 0.0,
            cache_write: 0.0,
            output: 0.0,
        }
    }
}

fn price_for(model: &str, custom_prices: &[ModelPrice]) -> (ModelPrice, bool) {
    if let Some(price) = custom_prices
        .iter()
        .find(|price| price.model.eq_ignore_ascii_case(model))
    {
        let mut price = price.clone();
        price.input = price.input.max(0.0);
        price.cache_read = price.cache_read.max(0.0);
        price.cache_write = price.cache_write.max(0.0);
        price.output = price.output.max(0.0);
        return (price, true);
    }
    (default_price_for(model), false)
}

fn provider_for(model: &str) -> &'static str {
    if model.to_ascii_lowercase().contains("mimo") {
        "MiMo Code"
    } else {
        "Claude Code"
    }
}

fn token_count(value: &Value, field: &str) -> u64 {
    value.get(field).and_then(Value::as_u64).unwrap_or_default()
}

fn record_totals(usage: &Value, price: &ModelPrice) -> Totals {
    let input_tokens = token_count(usage, "input_tokens");
    let cache_read_tokens = token_count(usage, "cache_read_input_tokens");
    let cache_write_tokens = token_count(usage, "cache_creation_input_tokens");
    let output_tokens = token_count(usage, "output_tokens");
    let cost_cny = (input_tokens as f64 * price.input
        + cache_read_tokens as f64 * price.cache_read
        + cache_write_tokens as f64 * price.cache_write
        + output_tokens as f64 * price.output)
        / 1_000_000.0;

    Totals {
        input_tokens,
        cache_read_tokens,
        cache_write_tokens,
        output_tokens,
        cost_cny,
    }
}

fn collect_jsonl_files(path: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn in_range(date: &str, from: Option<&str>, to: Option<&str>) -> bool {
    from.map(|value| date >= value).unwrap_or(true) && to.map(|value| date <= value).unwrap_or(true)
}

fn scan_mimo_connection(
    connection: &Connection,
    accumulator: &mut UsageAccumulator,
    from: Option<&str>,
    to: Option<&str>,
    custom_prices: &[ModelPrice],
) -> Result<(), String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                message.id,
                COALESCE(json_extract(message.data, '$.modelID'), 'unknown'),
                date(message.time_created / 1000, 'unixepoch'),
                COALESCE(json_extract(message.data, '$.tokens.input'), 0),
                COALESCE(json_extract(message.data, '$.tokens.cache.read'), 0),
                COALESCE(json_extract(message.data, '$.tokens.cache.write'), 0),
                COALESCE(json_extract(message.data, '$.tokens.output'), 0)
            FROM message
            WHERE json_extract(message.data, '$.role') = 'assistant'
              AND NOT EXISTS (
                SELECT 1
                FROM claude_import, json_each(claude_import.message_ids) imported
                WHERE imported.value = message.id
              )
            "#,
        )
        .map_err(|error| format!("无法读取 MiMo 数据库结构：{error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?.max(0) as u64,
                row.get::<_, i64>(4)?.max(0) as u64,
                row.get::<_, i64>(5)?.max(0) as u64,
                row.get::<_, i64>(6)?.max(0) as u64,
            ))
        })
        .map_err(|error| format!("无法查询 MiMo token 数据：{error}"))?;

    for row in rows {
        let (message_id, model, date, input, cache_read, cache_write, output) =
            row.map_err(|error| format!("无法解析 MiMo token 数据：{error}"))?;
        if !in_range(&date, from, to) {
            continue;
        }
        let usage = serde_json::json!({
            "input_tokens": input,
            "cache_read_input_tokens": cache_read,
            "cache_creation_input_tokens": cache_write,
            "output_tokens": output,
        });
        accumulator.add_record(&model, &date, &message_id, &usage, custom_prices);
    }

    Ok(())
}

fn scan_mimo_database(
    path: &Path,
    accumulator: &mut UsageAccumulator,
    from: Option<&str>,
    to: Option<&str>,
    custom_prices: &[ModelPrice],
) -> Result<(), String> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("无法打开 MiMo 数据库：{error}"))?;
    scan_mimo_connection(&connection, accumulator, from, to, custom_prices)
}

#[tauri::command]
fn scan_usage(
    from: Option<String>,
    to: Option<String>,
    custom_prices: Option<Vec<ModelPrice>>,
) -> Result<UsageReport, String> {
    let home = env::var("USERPROFILE").map_err(|_| "无法读取 USERPROFILE".to_string())?;
    let home = PathBuf::from(home);
    let claude_source = home.join(".claude").join("projects");
    let mimo_source = home
        .join(".local")
        .join("share")
        .join("mimocode")
        .join("mimocode.db");
    let mut files = Vec::new();
    collect_jsonl_files(&claude_source, &mut files);

    let mut accumulator = UsageAccumulator::default();
    let mut warnings = Vec::new();
    let custom_prices = custom_prices.unwrap_or_default();

    for path in &files {
        let Ok(file) = File::open(path) else {
            continue;
        };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let Ok(record) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(message) = record.get("message") else {
                continue;
            };
            if message.get("role").and_then(Value::as_str) != Some("assistant") {
                continue;
            }
            let Some(usage) = message.get("usage") else {
                continue;
            };
            let model = message
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let timestamp = record
                .get("timestamp")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let date = timestamp.get(..10).unwrap_or_default();
            if date.len() != 10 || !in_range(date, from.as_deref(), to.as_deref()) {
                continue;
            }

            let message_id = message
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            accumulator.add_record(model, date, message_id, usage, &custom_prices);
        }
    }

    let mimo_exists = mimo_source.is_file();
    if mimo_exists {
        if let Err(error) = scan_mimo_database(
            &mimo_source,
            &mut accumulator,
            from.as_deref(),
            to.as_deref(),
            &custom_prices,
        ) {
            warnings.push(error);
        }
    }

    let mut models: Vec<ModelUsage> = accumulator.models.into_values().collect();
    models.sort_by(|a, b| {
        b.totals
            .cost_cny
            .total_cmp(&a.totals.cost_cny)
            .then_with(|| b.totals.output_tokens.cmp(&a.totals.output_tokens))
    });
    let mut daily: Vec<DailyUsage> = accumulator.daily.into_values().collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));
    let mut model_daily: Vec<ModelDailyUsage> = accumulator.model_daily.into_values().collect();
    model_daily.sort_by(|a, b| {
        a.model
            .to_ascii_lowercase()
            .cmp(&b.model.to_ascii_lowercase())
            .then_with(|| a.date.cmp(&b.date))
    });

    if models.iter().any(|model| !model.priced) {
        warnings.push("MiMo 或未知模型没有公开可核验的 token 单价，成本暂按 ¥0 计算。".into());
    }
    if files.is_empty() && !mimo_exists {
        warnings.push("未发现 Claude JSONL 或 MiMo 数据库。".into());
    }

    Ok(UsageReport {
        source_dir: format!(
            "Claude: {} | MiMo: {}",
            claude_source.to_string_lossy(),
            mimo_source.to_string_lossy()
        ),
        files_scanned: files.len() as u64 + u64::from(mimo_exists),
        records_count: accumulator.records_count,
        date_min: daily.first().map(|item| item.date.clone()),
        date_max: daily.last().map(|item| item.date.clone()),
        totals: accumulator.totals,
        models,
        daily,
        model_daily,
        warnings,
    })
}

#[tauri::command]
fn export_report(format: String, contents: String) -> Result<String, String> {
    let extension = match format.as_str() {
        "csv" | "json" => format,
        _ => return Err("不支持的导出格式".into()),
    };
    let home = env::var("USERPROFILE").map_err(|_| "无法读取 USERPROFILE".to_string())?;
    let downloads = PathBuf::from(&home).join("Downloads");
    let target_dir = if downloads.is_dir() {
        downloads
    } else {
        PathBuf::from(home)
    };
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法生成导出时间戳：{error}"))?
        .as_secs();
    let path = target_dir.join(format!("token-ledger-export-{seconds}.{extension}"));
    fs::write(&path, contents).map_err(|error| format!("无法写入导出文件：{error}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_usage, export_report])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn calculates_sonnet_cost_in_cny() {
        let price = default_price_for("claude-sonnet-4-6");
        let totals = record_totals(
            &json!({
                "input_tokens": 1_000_000,
                "cache_read_input_tokens": 1_000_000,
                "cache_creation_input_tokens": 1_000_000,
                "output_tokens": 1_000_000
            }),
            &price,
        );

        assert_eq!(totals.input_tokens, 1_000_000);
        assert!((totals.cost_cny - 158.76).abs() < 0.001);
    }

    #[test]
    fn mimo_is_classified_but_not_priced() {
        let (price, custom) = price_for("mimo-v2.5-pro", &[]);
        assert!(!price.is_priced());
        assert!(!custom);
        assert_eq!(provider_for("mimo-v2.5-pro"), "MiMo Code");
    }

    #[test]
    fn custom_price_overrides_default_model_price() {
        let custom_prices = vec![ModelPrice {
            model: "mimo-v2.5-pro".into(),
            input: 2.0,
            cache_read: 0.5,
            cache_write: 2.5,
            output: 8.0,
        }];
        let (price, custom) = price_for("MIMO-V2.5-PRO", &custom_prices);
        let totals = record_totals(
            &json!({
                "input_tokens": 1_000_000,
                "cache_read_input_tokens": 1_000_000,
                "cache_creation_input_tokens": 1_000_000,
                "output_tokens": 1_000_000
            }),
            &price,
        );

        assert!(custom);
        assert!(price.is_priced());
        assert!((totals.cost_cny - 13.0).abs() < 0.001);
    }

    #[test]
    fn export_report_writes_supported_formats() {
        let home = env::temp_dir().join(format!(
            "token-ledger-export-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(home.join("Downloads")).unwrap();
        env::set_var("USERPROFILE", &home);

        let path = export_report("csv".into(), "section,date\nsummary,".into()).unwrap();
        assert!(path.ends_with(".csv"));
        assert!(PathBuf::from(&path).is_file());
        assert!(export_report("xml".into(), "<x />".into()).is_err());

        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn date_range_is_inclusive() {
        assert!(in_range(
            "2026-06-01",
            Some("2026-06-01"),
            Some("2026-06-12")
        ));
        assert!(in_range(
            "2026-06-12",
            Some("2026-06-01"),
            Some("2026-06-12")
        ));
        assert!(!in_range(
            "2026-05-31",
            Some("2026-06-01"),
            Some("2026-06-12")
        ));
    }

    #[test]
    fn mimo_database_excludes_messages_imported_from_claude() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE message (
                    id TEXT PRIMARY KEY,
                    time_created INTEGER NOT NULL,
                    data TEXT NOT NULL
                );
                CREATE TABLE claude_import (
                    source_uuid TEXT PRIMARY KEY,
                    message_ids TEXT
                );
                INSERT INTO message VALUES (
                    'imported',
                    1781222400000,
                    '{"role":"assistant","modelID":"mimo-v2.5-pro","tokens":{"input":10,"cache":{"read":20,"write":30},"output":40}}'
                );
                INSERT INTO message VALUES (
                    'native',
                    1781222400000,
                    '{"role":"assistant","modelID":"mimo-auto","tokens":{"input":100,"cache":{"read":200,"write":300},"output":400}}'
                );
                INSERT INTO claude_import VALUES ('source', '["imported"]');
                "#,
            )
            .unwrap();

        let mut accumulator = UsageAccumulator::default();
        scan_mimo_connection(&connection, &mut accumulator, None, None, &[]).unwrap();

        assert_eq!(accumulator.records_count, 1);
        assert_eq!(accumulator.models.len(), 1);
        assert_eq!(accumulator.totals.input_tokens, 100);
        assert_eq!(accumulator.totals.cache_read_tokens, 200);
        assert_eq!(accumulator.totals.cache_write_tokens, 300);
        assert_eq!(accumulator.totals.output_tokens, 400);
        assert!(accumulator.models.contains_key("mimo-auto"));
        assert_eq!(accumulator.model_daily.len(), 1);
        let daily = accumulator.model_daily.values().next().unwrap();
        assert_eq!(daily.model, "mimo-auto");
        assert_eq!(daily.date, "2026-06-12");
        assert_eq!(daily.totals.output_tokens, 400);
    }
}
