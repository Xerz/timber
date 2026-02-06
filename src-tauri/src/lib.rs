use serde::{Deserialize, Serialize};
use shell_words::split;
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

const CACHE_TTL_SECS: u64 = 24 * 60 * 60;

#[derive(Default)]
struct SharedState {
    launches: Mutex<HashMap<String, LaunchParams>>,
    desktop_ids: Mutex<HashSet<String>>,
}

#[derive(Clone, Debug)]
struct LaunchParams {
    exe_path: String,
    work_dir: String,
    args: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Card {
    product_id: String,
    title: String,
    image_url: String,
    alt: String,
    required_account: String,
    is_free: bool,
}

#[derive(Serialize, Clone)]
struct StatusPayload {
    text: String,
    current: Option<u32>,
    total: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct StationProduct {
    #[serde(alias = "productId")]
    product_id: String,
    #[serde(default)]
    enabled: bool,
    #[serde(alias = "useDefaultDesktop")]
    use_default_desktop: Option<bool>,
    #[serde(alias = "gamePath")]
    game_path: Option<String>,
    #[serde(alias = "workPath")]
    work_path: Option<String>,
    #[serde(alias = "args")]
    args: Option<String>,
    #[serde(alias = "title")]
    title: Option<String>,
    #[serde(default)]
    verified: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProductMeta {
    product_id: String,
    title: Option<String>,
    display_name: Option<String>,
    description_ru: Option<String>,
    card_picture: Option<String>,
    required_account: Option<String>,
    no_license_requred: Option<bool>,
    use_default_desktop: Option<bool>,
}

struct StationInfo {
    uuid: String,
    token: String,
}

#[tauri::command]
async fn load_cards(app: AppHandle, state: State<'_, SharedState>) -> Result<Vec<Card>, String> {
    let client = reqwest::Client::new();

    emit_status(&app, "Получаем токен и UUID станции…", None, None);
    let station = get_station_info()?;

    emit_status(&app, "Загружаем список игр…", None, None);
    let station_products: Vec<StationProduct> =
        http_get_json(&client, station_products_url(&station.uuid), &station.token).await?;
    let enabled_products: Vec<StationProduct> = station_products
        .into_iter()
        .filter(is_station_product_ready)
        .collect();
    if enabled_products.is_empty() {
        return Err("Список игр пуст".to_string());
    }

    emit_status(&app, "Загружаем каталог игр…", None, None);
    let products_full: Vec<ProductMeta> =
        http_get_json(&client, products_full_url(), &station.token).await?;
    let product_map = build_product_map(&products_full);

    let desktop_ids = build_desktop_set(&enabled_products, &product_map);

    let mut launch_map: HashMap<String, LaunchParams> = HashMap::new();
    for item in enabled_products.iter() {
        launch_map.insert(item.product_id.clone(), build_launch_params(item));
    }

    emit_status(&app, "Загружаем ресурсы…", None, None);
    let mut cards: Vec<Card> = Vec::new();
    for (idx, item) in enabled_products.iter().enumerate() {
        let current = (idx + 1) as u32;
        let total = enabled_products.len() as u32;
        emit_status(
            &app,
            "Загружаем ресурсы…",
            Some(current),
            Some(total),
        );

        let meta = product_map.get(&item.product_id);
        let image_url = match meta.and_then(|m| m.card_picture.clone()) {
            Some(url) => match cache_image(&client, &url).await {
                Ok(Some(cached)) => cached,
                _ => url,
            },
            None => String::new(),
        };

        let title = meta
            .and_then(|m| m.display_name.clone())
            .or_else(|| meta.and_then(|m| m.title.clone()))
            .or_else(|| item.title.clone())
            .unwrap_or_else(|| "Игра".to_string());

        let description = meta
            .and_then(|m| m.description_ru.clone())
            .unwrap_or_default();
        let alt = if description.len() > 100 {
            description[..100].to_string()
        } else {
            description
        };

        let required_account = meta
            .and_then(|m| m.required_account.clone())
            .unwrap_or_default();
        let is_free = meta
            .and_then(|m| m.no_license_requred)
            .unwrap_or(false);

        cards.push(Card {
            product_id: item.product_id.clone(),
            title,
            image_url,
            alt,
            required_account,
            is_free,
        });
    }

    {
        let mut state_launches = state.launches.lock().map_err(|_| "State locked")?;
        *state_launches = launch_map;
        let mut state_desktop = state.desktop_ids.lock().map_err(|_| "State locked")?;
        *state_desktop = desktop_ids;
    }

    Ok(cards)
}

#[tauri::command]
fn launch_game(app: AppHandle, state: State<'_, SharedState>, product_id: String) -> Result<(), String> {
    let desktop_ids = state.desktop_ids.lock().map_err(|_| "State locked")?;
    if desktop_ids.contains(&product_id) || product_id == "desktop" {
        hide_window(&app);
        app.exit(0);
        return Ok(());
    }

    let launches = state.launches.lock().map_err(|_| "State locked")?;
    let launch = launches
        .get(&product_id)
        .ok_or_else(|| "Не найдено описание запуска".to_string())?;
    if launch.exe_path.is_empty() {
        return Err("Пустой путь запуска".to_string());
    }

    hide_window(&app);

    let mut command = Command::new(&launch.exe_path);
    if !launch.work_dir.is_empty() {
        command.current_dir(&launch.work_dir);
    }
    if !launch.args.is_empty() {
        if let Ok(args) = split(&launch.args) {
            command.args(args);
        }
    }
    command.spawn().map_err(|err| err.to_string())?;

    app.exit(0);
    Ok(())
}

fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn emit_status(app: &AppHandle, text: &str, current: Option<u32>, total: Option<u32>) {
    let _ = app.emit(
        "status",
        StatusPayload {
            text: text.to_string(),
            current,
            total,
        },
    );
}

async fn http_get_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: String,
    token: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .header("X-Auth-Token", token)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response.json::<T>().await.map_err(|err| err.to_string())
}

fn station_products_url(station_uuid: &str) -> String {
    format!(
        "https://services.drova.io/product-manager/serverproduct/list/{}",
        station_uuid
    )
}

fn products_full_url() -> String {
    "https://services.drova.io/product-manager/product/listfull2?limit=2000".to_string()
}

fn build_product_map(list: &[ProductMeta]) -> HashMap<String, ProductMeta> {
    let mut map = HashMap::new();
    for item in list {
        map.insert(item.product_id.clone(), item.clone());
    }
    map
}

fn build_desktop_set(
    enabled_products: &[StationProduct],
    product_map: &HashMap<String, ProductMeta>,
) -> HashSet<String> {
    let mut set = HashSet::new();
    for item in enabled_products {
        let meta = product_map.get(&item.product_id);
        if is_desktop_product(item, meta) {
            set.insert(item.product_id.clone());
        }
    }
    set
}

fn is_desktop_product(item: &StationProduct, meta: Option<&ProductMeta>) -> bool {
    if item.use_default_desktop.unwrap_or(false) {
        return true;
    }
    if meta
        .and_then(|m| m.use_default_desktop)
        .unwrap_or(false)
    {
        return true;
    }

    let title = meta
        .and_then(|m| m.title.clone())
        .or_else(|| item.title.clone())
        .unwrap_or_default()
        .to_lowercase();
    if title == "desktop" {
        return true;
    }

    let display_name = meta
        .and_then(|m| m.display_name.clone())
        .unwrap_or_default()
        .to_lowercase();
    if display_name == "рабочий стол" {
        return true;
    }

    false
}

fn build_launch_params(item: &StationProduct) -> LaunchParams {
    let exe_path = item.game_path.clone().unwrap_or_default();
    let work_dir = item.work_path.clone().unwrap_or_default();
    let args = item.args.clone().unwrap_or_default();

    LaunchParams {
        exe_path,
        work_dir,
        args,
    }
}

fn is_station_product_ready(item: &StationProduct) -> bool {
    if !item.enabled {
        return false;
    }
    match item.verified.as_deref() {
        Some(value) => value.eq_ignore_ascii_case("READY"),
        None => true,
    }
}

async fn cache_image(client: &reqwest::Client, url: &str) -> Result<Option<String>, String> {
    let cache_dir = std::env::temp_dir().join("drova-launcher").join("images");

    fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;

    let file_name = cache_file_name(url);
    let file_path = cache_dir.join(file_name);

    if let Ok(metadata) = fs::metadata(&file_path) {
        if let Ok(modified) = metadata.modified() {
            if !is_expired(modified, Duration::from_secs(CACHE_TTL_SECS)) {
                return Ok(Some(file_url(&file_path)?));
            }
        }
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    fs::write(&file_path, &bytes).map_err(|err| err.to_string())?;
    Ok(Some(file_url(&file_path)?))
}

fn cache_file_name(url: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(url.as_bytes());
    let hash = hex::encode(hasher.finalize());
    let ext = Path::new(url.split('?').next().unwrap_or(""))
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("img");
    format!("{}.{}", hash, ext)
}

fn file_url(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map(|url| url.to_string())
        .map_err(|_| "Не удалось создать file URL".to_string())
}

fn is_expired(modified: SystemTime, ttl: Duration) -> bool {
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age > ttl)
        .unwrap_or(true)
}

fn get_station_info() -> Result<StationInfo, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let esme = hklm
            .open_subkey("SOFTWARE\\ITKey\\Esme")
            .map_err(|err| err.to_string())?;
        let station_uuid: String = esme.get_value("last_server").map_err(|err| err.to_string())?;
        let token_key = format!("SOFTWARE\\ITKey\\Esme\\servers\\{}", station_uuid);
        let server_key = hklm.open_subkey(token_key).map_err(|err| err.to_string())?;
        let token: String = server_key.get_value("auth_token").map_err(|err| err.to_string())?;

        return Ok(StationInfo {
            uuid: station_uuid,
            token,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        dotenvy::dotenv().ok();
        let uuid = std::env::var("DROVA_STATION_UUID")
            .map_err(|_| "DROVA_STATION_UUID не задан".to_string())?;
        let token = std::env::var("DROVA_AUTH_TOKEN")
            .map_err(|_| "DROVA_AUTH_TOKEN не задан".to_string())?;
        return Ok(StationInfo { uuid, token });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SharedState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![load_cards, launch_game])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn sample_meta(product_id: &str) -> ProductMeta {
        ProductMeta {
            product_id: product_id.to_string(),
            title: None,
            display_name: None,
            description_ru: None,
            card_picture: None,
            required_account: None,
            no_license_requred: None,
            use_default_desktop: None,
        }
    }

    fn sample_item(product_id: &str) -> StationProduct {
        StationProduct {
            product_id: product_id.to_string(),
            enabled: true,
            use_default_desktop: None,
            game_path: None,
            work_path: None,
            args: None,
            verified: Some("READY".to_string()),
            title: None,
        }
    }

    #[test]
    fn test_build_launch_params_from_station() {
        let item = StationProduct {
            product_id: "p1".to_string(),
            enabled: true,
            use_default_desktop: None,
            game_path: Some("C:\\Game.exe".to_string()),
            work_path: Some("C:\\Work".to_string()),
            args: Some("-custom".to_string()),
            verified: Some("READY".to_string()),
            title: None,
        };
        let launch = build_launch_params(&item);
        assert_eq!(launch.exe_path, "C:\\Game.exe");
        assert_eq!(launch.work_dir, "C:\\Work");
        assert_eq!(launch.args, "-custom");
    }

    #[test]
    fn test_is_desktop_product_by_flag() {
        let mut item = sample_item("p1");
        item.use_default_desktop = Some(true);
        assert!(is_desktop_product(&item, None));
    }

    #[test]
    fn test_is_desktop_product_by_meta_flag() {
        let item = sample_item("p1");
        let mut meta = sample_meta("p1");
        meta.use_default_desktop = Some(true);
        assert!(is_desktop_product(&item, Some(&meta)));
    }

    #[test]
    fn test_is_desktop_product_by_title() {
        let mut item = sample_item("p1");
        item.title = Some("Desktop".to_string());
        assert!(is_desktop_product(&item, None));
    }

    #[test]
    fn test_is_desktop_product_by_display_name() {
        let item = sample_item("p1");
        let mut meta = sample_meta("p1");
        meta.display_name = Some("Рабочий стол".to_string());
        assert!(is_desktop_product(&item, Some(&meta)));
    }

    #[test]
    fn test_is_station_product_ready() {
        let mut disabled = sample_item("p1");
        disabled.enabled = false;
        assert!(!is_station_product_ready(&disabled));

        let mut not_ready = sample_item("p1");
        not_ready.verified = Some("NOT_READY".to_string());
        assert!(!is_station_product_ready(&not_ready));

        let mut missing_verified = sample_item("p1");
        missing_verified.verified = None;
        assert!(is_station_product_ready(&missing_verified));
    }

    #[test]
    fn test_build_desktop_set() {
        let mut item = sample_item("p1");
        item.use_default_desktop = Some(true);
        let mut map = HashMap::new();
        map.insert("p1".to_string(), sample_meta("p1"));
        let set = build_desktop_set(&[item], &map);
        assert!(set.contains("p1"));
    }

    #[test]
    fn test_cache_file_name_extension() {
        let name = cache_file_name("https://example.com/image.jpg?x=1");
        assert!(name.ends_with(".jpg"));
        assert!(name.len() > 10);
    }

    #[test]
    fn test_cache_file_name_default_extension() {
        let name = cache_file_name("https://example.com/image");
        assert!(name.ends_with(".img"));
    }

    #[test]
    fn test_file_url() {
        let url = file_url(Path::new("/tmp/test.png")).unwrap();
        assert!(url.starts_with("file://"));
    }

    #[test]
    fn test_is_expired() {
        let recent = SystemTime::now() - Duration::from_secs(10);
        let old = SystemTime::now() - Duration::from_secs(100);
        assert!(!is_expired(recent, Duration::from_secs(60)));
        assert!(is_expired(old, Duration::from_secs(60)));
    }

    #[test]
    fn test_build_product_map_overwrites_duplicates() {
        let mut first = sample_meta("p1");
        first.title = Some("First".to_string());
        let mut second = sample_meta("p1");
        second.title = Some("Second".to_string());
        let map = build_product_map(&[first, second]);
        assert_eq!(map.len(), 1);
        let meta = map.get("p1").unwrap();
        assert_eq!(meta.title.as_deref(), Some("Second"));
    }

    #[test]
    fn test_station_products_url() {
        let url = station_products_url("uuid-1");
        assert_eq!(
            url,
            "https://services.drova.io/product-manager/serverproduct/list/uuid-1"
        );
    }

    #[test]
    fn test_products_full_url() {
        let url = products_full_url();
        assert_eq!(
            url,
            "https://services.drova.io/product-manager/product/listfull2?limit=2000"
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn test_get_station_info_from_env() {
        std::env::set_var("DROVA_STATION_UUID", "uuid-env");
        std::env::set_var("DROVA_AUTH_TOKEN", "token-env");
        let info = get_station_info().unwrap();
        assert_eq!(info.uuid, "uuid-env");
        assert_eq!(info.token, "token-env");
        std::env::remove_var("DROVA_STATION_UUID");
        std::env::remove_var("DROVA_AUTH_TOKEN");
    }
}
