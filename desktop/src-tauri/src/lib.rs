use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Components, Disks, Networks, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not find the CSRIFT data folder: {error}"))?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create the CSRIFT data folder: {error}"))?;
    Ok(path)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessUsage {
    name: String,
    cpu_percent: f32,
    memory_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskUsage {
    name: String,
    total_bytes: u64,
    available_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemSnapshot {
    os_name: Option<String>,
    cpu_name: String,
    cpu_usage_percent: Option<f32>,
    cpu_temperature_c: Option<f32>,
    memory_total_bytes: u64,
    memory_used_bytes: u64,
    memory_usage_percent: Option<f32>,
    gpu_name: Option<String>,
    gpu_usage_percent: Option<f32>,
    gpu_temperature_c: Option<f32>,
    vram_total_bytes: Option<u64>,
    cs2_running: bool,
    active_process_count: usize,
    processes: Vec<ProcessUsage>,
    disks: Vec<DiskUsage>,
    network_interfaces: Vec<String>,
    captured_at_ms: u128,
}

#[tauri::command]
async fn get_system_snapshot() -> Result<SystemSnapshot, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut system = System::new_all();
        system.refresh_cpu_all();
        thread::sleep(Duration::from_millis(220));
        system.refresh_cpu_all();
        system.refresh_memory();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let cpus = system.cpus();
        let cpu_usage_percent = if cpus.is_empty() {
            None
        } else {
            Some(cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / cpus.len() as f32)
        };
        let memory_total_bytes = system.total_memory();
        let memory_used_bytes = system.used_memory();
        let memory_usage_percent = (memory_total_bytes > 0).then(|| {
            (memory_used_bytes as f64 / memory_total_bytes as f64 * 100.0) as f32
        });

        let components = Components::new_with_refreshed_list();
        let cpu_temperature_c = components
            .iter()
            .find(|component| component.label().to_ascii_lowercase().contains("cpu"))
            .and_then(|component| component.temperature());
        let gpu_component = components.iter().find(|component| {
            let label = component.label().to_ascii_lowercase();
            label.contains("gpu") || label.contains("graphics")
        });
        let gpu_temperature_c = gpu_component.and_then(|component| component.temperature());

        let gpu_name = if gpu_component.is_some() {
            Some("Graphics sensor detected".to_string())
        } else {
            None
        };

        let mut processes = system
            .processes()
            .values()
            .map(|process| ProcessUsage {
                name: process.name().to_string_lossy().into_owned(),
                cpu_percent: process.cpu_usage(),
                memory_bytes: process.memory(),
            })
            .collect::<Vec<_>>();
        processes.sort_by(|left, right| {
            right
                .cpu_percent
                .total_cmp(&left.cpu_percent)
                .then_with(|| right.memory_bytes.cmp(&left.memory_bytes))
        });
        processes.truncate(8);

        let disks = Disks::new_with_refreshed_list()
            .iter()
            .map(|disk| DiskUsage {
                name: disk.mount_point().to_string_lossy().into_owned(),
                total_bytes: disk.total_space(),
                available_bytes: disk.available_space(),
            })
            .collect();
        let network_interfaces = Networks::new_with_refreshed_list()
            .keys()
            .cloned()
            .collect();
        let cs2_running = system.processes().values().any(|process| {
            process.name().to_string_lossy().eq_ignore_ascii_case("cs2.exe")
        });

        Ok(SystemSnapshot {
            os_name: System::long_os_version(),
            cpu_name: cpus
                .first()
                .map(|cpu| cpu.brand().trim().to_string())
                .unwrap_or_else(|| "CPU model unavailable".to_string()),
            cpu_usage_percent,
            cpu_temperature_c,
            memory_total_bytes,
            memory_used_bytes,
            memory_usage_percent,
            gpu_name,
            gpu_usage_percent: None,
            gpu_temperature_c,
            vram_total_bytes: None,
            cs2_running,
            active_process_count: system.processes().len(),
            processes,
            disks,
            network_interfaces,
            captured_at_ms: unix_millis(),
        })
    })
    .await
    .map_err(|error| format!("System monitoring failed: {error}"))?
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PingResult {
    target: String,
    sent: u32,
    received: u32,
    packet_loss_percent: f32,
    average_latency_ms: Option<f64>,
    latencies_ms: Vec<String>,
    measured_at_ms: u128,
}

fn parse_ping_output(output: &str) -> (u32, Vec<String>, Vec<f64>) {
    let mut replies = 0;
    let mut displayed_times = Vec::new();
    let mut measured_times = Vec::new();
    for line in output.lines() {
        let lower = line.to_ascii_lowercase();
        if !lower.contains("ttl=") {
            continue;
        }
        replies += 1;
        if lower.contains("time<1ms") {
            displayed_times.push("<1 ms".to_string());
            continue;
        }
        let Some((_, time)) = lower.split_once("time=") else {
            continue;
        };
        let end = time
            .find(|character: char| !character.is_ascii_digit() && character != '.')
            .unwrap_or(time.len());
        let Ok(value) = time[..end].parse::<f64>() else {
            continue;
        };
        measured_times.push(value);
        displayed_times.push(format!("{value} ms"));
    }
    (replies, displayed_times, measured_times)
}

#[tauri::command]
async fn run_ping_test(target: String) -> Result<PingResult, String> {
    let address = target
        .trim()
        .parse::<IpAddr>()
        .map_err(|_| "Enter a valid IPv4 or IPv6 address to ping.".to_string())?;
    let target = address.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new("ping");
        command.args(["-n", "4", "-w", "1200"]);
        if address.is_ipv4() {
            command.arg("-4");
        } else {
            command.arg("-6");
        }
        let output = command
            .arg(&target)
            .output()
            .map_err(|error| format!("Could not start the Windows ping utility: {error}"))?;
        if !output.status.success() && output.stdout.is_empty() {
            return Err(format!(
                "The Windows ping utility failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        let response = String::from_utf8_lossy(&output.stdout);
        let (received, latencies_ms, measured_latencies) = parse_ping_output(&response);
        let packet_loss_percent = (4 - received.min(4)) as f32 / 4.0 * 100.0;
        let average_latency_ms = (!measured_latencies.is_empty())
            .then(|| measured_latencies.iter().sum::<f64>() / measured_latencies.len() as f64);

        Ok(PingResult {
            target,
            sent: 4,
            received,
            packet_loss_percent,
            average_latency_ms,
            latencies_ms,
            measured_at_ms: unix_millis(),
        })
    })
    .await
    .map_err(|error| format!("Network diagnostics failed: {error}"))?
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupEntry {
    name: String,
    command: String,
    source: String,
}

#[tauri::command]
fn list_startup_entries() -> Result<Vec<StartupEntry>, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::{enums::*, RegKey};
        let mut entries = Vec::new();
        let registry_roots = [
            (HKEY_CURRENT_USER, "HKCU"),
            (HKEY_LOCAL_MACHINE, "HKLM"),
        ];
        let registry_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        for (root, source) in registry_roots {
            let root_key = RegKey::predef(root);
            if let Ok(key) = root_key.open_subkey(registry_path) {
                for item in key.enum_values() {
                    if let Ok((name, _)) = item {
                        if let Ok(command) = key.get_value::<String, _>(&name) {
                            entries.push(StartupEntry {
                                name,
                                command,
                                source: source.to_string(),
                            });
                        }
                    }
                }
            }
        }
        return Ok(entries);
    }

    #[cfg(not(target_os = "windows"))]
    Err("Startup inventory is supported only on Windows.".to_string())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnsServer {
    address: String,
}

#[tauri::command]
fn list_dns_servers() -> Result<Vec<DnsServer>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = "Get-DnsClientServerAddress | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ } | Sort-Object -Unique";
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .map_err(|error| format!("Could not read Windows DNS settings: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Windows could not read DNS server addresses: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let mut servers = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse::<IpAddr>().ok())
            .map(|address| DnsServer {
                address: address.to_string(),
            })
            .collect::<Vec<_>>();
        servers.sort_by(|left, right| left.address.cmp(&right.address));
        servers.dedup_by(|left, right| left.address == right.address);
        return Ok(servers);
    }

    #[cfg(not(target_os = "windows"))]
    Err("DNS settings are supported only on Windows.".to_string())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PowerPlan {
    name: Option<String>,
    guid: Option<String>,
    available: bool,
}

#[tauri::command]
fn get_active_power_plan() -> Result<PowerPlan, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powercfg.exe")
            .arg("/getactivescheme")
            .output()
            .map_err(|error| format!("Could not inspect the current Windows power plan: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Windows could not read the active power plan: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let output = String::from_utf8_lossy(&output.stdout);
        let guid = output
            .split_whitespace()
            .map(|token| token.trim_matches(|character: char| !character.is_ascii_hexdigit() && character != '-'))
            .find(|token| {
                token.len() == 36
                    && token.chars().enumerate().all(|(index, character)| {
                        if [8, 13, 18, 23].contains(&index) {
                            character == '-'
                        } else {
                            character.is_ascii_hexdigit()
                        }
                    })
            })
            .map(str::to_string);
        let name = output
            .rsplit_once('(')
            .and_then(|(_, suffix)| suffix.split_once(')').map(|(value, _)| value.trim().to_string()))
            .filter(|value| !value.is_empty());
        return Ok(PowerPlan {
            name,
            guid,
            available: true,
        });
    }

    #[cfg(not(target_os = "windows"))]
    Err("Windows power plans are supported only on Windows.".to_string())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TempScan {
    directory: String,
    eligible_files: usize,
    total_bytes: u64,
}

fn eligible_temp_files() -> Result<(PathBuf, Vec<(PathBuf, u64)>), String> {
    let temp_dir = std::env::temp_dir();
    if !temp_dir.is_absolute() || !temp_dir.exists() {
        return Err("The Windows temporary folder is unavailable.".to_string());
    }
    let cutoff = SystemTime::now() - Duration::from_secs(24 * 60 * 60);
    let mut files = Vec::new();
    let entries = fs::read_dir(&temp_dir)
        .map_err(|error| format!("Could not scan the temporary folder: {error}"))?;
    for item in entries {
        let item = item.map_err(|error| format!("Could not inspect a temporary item: {error}"))?;
        let file_type = item
            .file_type()
            .map_err(|error| format!("Could not inspect a temporary item: {error}"))?;
        if !file_type.is_file() {
            continue;
        }
        let metadata = item
            .metadata()
            .map_err(|error| format!("Could not read temporary-file information: {error}"))?;
        let older_than_one_day = metadata
            .modified()
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if older_than_one_day {
            files.push((item.path(), metadata.len()));
        }
    }
    Ok((temp_dir, files))
}

#[tauri::command]
fn scan_temporary_files() -> Result<TempScan, String> {
    let (directory, files) = eligible_temp_files()?;
    Ok(TempScan {
        directory: directory.to_string_lossy().into_owned(),
        eligible_files: files.len(),
        total_bytes: files.iter().map(|(_, size)| size).sum(),
    })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupResult {
    removed_files: usize,
    freed_bytes: u64,
    skipped_files: usize,
}

#[tauri::command]
fn clean_temporary_files() -> Result<CleanupResult, String> {
    let (_, files) = eligible_temp_files()?;
    let mut result = CleanupResult {
        removed_files: 0,
        freed_bytes: 0,
        skipped_files: 0,
    };
    for (path, size) in files {
        match fs::remove_file(&path) {
            Ok(()) => {
                result.removed_files += 1;
                result.freed_bytes += size;
            }
            Err(_) => result.skipped_files += 1,
        }
    }
    if result.removed_files == 0 && result.skipped_files > 0 {
        return Err("No eligible temporary files could be removed; they may be in use.".to_string());
    }
    Ok(result)
}

fn steam_directories() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for env_key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(value) = std::env::var_os(env_key) {
            candidates.push(PathBuf::from(value).join("Steam"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let steam_key = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = steam_key.open_subkey("Software\\Valve\\Steam") {
            if let Ok(path) = key.get_value::<String, _>("SteamPath") {
                candidates.push(PathBuf::from(path));
            }
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates
}

fn find_cs2_config_dir() -> Option<PathBuf> {
    for steam_dir in steam_directories() {
        let userdata = steam_dir.join("userdata");
        let Ok(users) = fs::read_dir(userdata) else {
            continue;
        };
        for user in users.flatten() {
            if !user.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let cfg = user.path().join("730").join("local").join("cfg");
            if cfg.is_dir() {
                return Some(cfg);
            }
        }
    }
    None
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigStatus {
    detected: bool,
    path: Option<String>,
    files: Vec<String>,
    changed_files: Vec<String>,
    compared_backup_id: Option<String>,
}

fn config_files(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }
            let path = entry.path();
            let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
            ["cfg", "vcfg"].contains(&extension.as_str()).then(|| {
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            })
        })
        .collect()
}

#[tauri::command]
fn get_cs2_config_status(app: AppHandle) -> Result<ConfigStatus, String> {
    let Some(path) = find_cs2_config_dir() else {
        return Ok(ConfigStatus {
            detected: false,
            path: None,
            files: Vec::new(),
            changed_files: Vec::new(),
            compared_backup_id: None,
        });
    };
    let files = config_files(&path);
    let latest = saved_backups(&app)?.into_iter().next();
    let mut changed_files = Vec::new();
    if let Some(backup) = &latest {
        let backup_dir = backup_root(&app)?.join(&backup.id);
        for name in &backup.files {
            if !files.contains(name) {
                changed_files.push(name.clone());
            }
        }
        for name in &files {
            let original = backup_dir.join(name);
            if !original.is_file() {
                changed_files.push(name.clone());
                continue;
            }
            let current = fs::read(path.join(name))
                .map_err(|error| format!("Could not compare current CS2 settings: {error}"))?;
            let saved = fs::read(original)
                .map_err(|error| format!("Could not read the latest CS2 backup: {error}"))?;
            if current != saved {
                changed_files.push(name.clone());
            }
        }
        changed_files.sort();
        changed_files.dedup();
    }
    Ok(ConfigStatus {
        detected: true,
        path: Some(path.to_string_lossy().into_owned()),
        files,
        changed_files,
        compared_backup_id: latest.map(|backup| backup.id),
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigBackup {
    id: String,
    created_at_ms: u128,
    files: Vec<String>,
    directory: String,
}

fn backup_root(app: &AppHandle) -> Result<PathBuf, String> {
    let path = data_dir(app)?.join("backups");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create the local backup folder: {error}"))?;
    Ok(path)
}

fn saved_backups(app: &AppHandle) -> Result<Vec<ConfigBackup>, String> {
    let root = backup_root(app)?;
    let mut result = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("Could not read local backups: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not inspect a backup: {error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Could not inspect a backup: {error}"))?
            .is_dir()
        {
            continue;
        }
        let manifest = entry.path().join("manifest.json");
        if !manifest.is_file() {
            continue;
        }
        let content = fs::read_to_string(&manifest)
            .map_err(|error| format!("Could not read backup information: {error}"))?;
        let backup: ConfigBackup = serde_json::from_str(&content)
            .map_err(|error| format!("A backup record is invalid: {error}"))?;
        result.push(backup);
    }
    result.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    Ok(result)
}

#[tauri::command]
fn create_config_backup(app: AppHandle) -> Result<ConfigBackup, String> {
    let config_dir = find_cs2_config_dir().ok_or_else(|| {
        "CS2 settings were not found. Open Steam and launch CS2 once to create its local settings folder.".to_string()
    })?;
    let files = config_files(&config_dir);
    if files.is_empty() {
        return Err("The detected CS2 folder has no supported .cfg or .vcfg files to back up.".to_string());
    }
    let root = backup_root(&app)?;
    let id = unix_millis().to_string();
    let destination = root.join(&id);
    fs::create_dir_all(&destination)
        .map_err(|error| format!("Could not create the backup: {error}"))?;
    for name in &files {
        let source = config_dir.join(name);
        let output = destination.join(name);
        if let Err(error) = fs::copy(&source, &output) {
            let _ = fs::remove_dir_all(&destination);
            return Err(format!("Could not back up {name}: {error}"));
        }
    }
    let backup = ConfigBackup {
        id,
        created_at_ms: unix_millis(),
        files,
        directory: config_dir.to_string_lossy().into_owned(),
    };
    let manifest = serde_json::to_vec_pretty(&backup)
        .map_err(|error| format!("Could not save backup information: {error}"))?;
    fs::write(destination.join("manifest.json"), manifest)
        .map_err(|error| format!("Could not save backup information: {error}"))?;
    Ok(backup)
}

#[tauri::command]
fn list_config_backups(app: AppHandle) -> Result<Vec<ConfigBackup>, String> {
    saved_backups(&app)
}

#[tauri::command]
fn restore_config_backup(app: AppHandle, backup_id: String) -> Result<ConfigBackup, String> {
    if backup_id.is_empty() || !backup_id.chars().all(|character| character.is_ascii_digit()) {
        return Err("The selected backup ID is invalid.".to_string());
    }
    let backup = saved_backups(&app)?
        .into_iter()
        .find(|backup| backup.id == backup_id)
        .ok_or_else(|| "The selected backup could not be found.".to_string())?;
    let live_config = PathBuf::from(&backup.directory);
    if !live_config.is_dir() {
        return Err("The original CS2 settings folder no longer exists.".to_string());
    }
    let stored = backup_root(&app)?.join(&backup.id);
    for name in &backup.files {
        let extension = Path::new(name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !["cfg", "vcfg"].contains(&extension.as_str())
            || Path::new(name).file_name().and_then(|value| value.to_str()) != Some(name)
        {
            return Err("A backup contains an unsupported file name; restore was cancelled.".to_string());
        }
        let source = stored.join(name);
        if !source.is_file() {
            return Err(format!("A backed-up file is missing: {name}"));
        }
    }

    let safety = create_config_backup(app.clone())?;
    for name in &backup.files {
        fs::copy(stored.join(name), live_config.join(name))
            .map_err(|error| format!("Could not restore {name}; safety backup {} was created: {error}", safety.id))?;
    }
    Ok(safety)
}

#[tauri::command]
fn open_cs2_config_folder() -> Result<(), String> {
    let path = find_cs2_config_dir()
        .ok_or_else(|| "The local CS2 settings folder was not found.".to_string())?;
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open File Explorer: {error}"))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    accent: String,
    reduce_motion: bool,
    intro_enabled: bool,
    notifications_enabled: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            accent: "ember".to_string(),
            reduce_motion: false,
            intro_enabled: true,
            notifications_enabled: true,
        }
    }
}

#[tauri::command]
fn load_desktop_settings(app: AppHandle) -> Result<DesktopSettings, String> {
    let file = data_dir(&app)?.join("settings.json");
    if !file.exists() {
        return Ok(DesktopSettings::default());
    }
    let content = fs::read_to_string(&file)
        .map_err(|error| format!("Could not read CSRIFT settings: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("CSRIFT settings are invalid: {error}"))
}

#[tauri::command]
fn save_desktop_settings(app: AppHandle, settings: DesktopSettings) -> Result<(), String> {
    if !["ember", "amber"].contains(&settings.accent.as_str()) {
        return Err("The selected accent color is not supported.".to_string());
    }
    let content = serde_json::to_vec_pretty(&settings)
        .map_err(|error| format!("Could not encode CSRIFT settings: {error}"))?;
    fs::write(data_dir(&app)?.join("settings.json"), content)
        .map_err(|error| format!("Could not save CSRIFT settings: {error}"))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigProfile {
    id: String,
    name: String,
    created_at_ms: u128,
    backup_id: String,
    files: Vec<String>,
}

fn validate_profile_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > 32
        || !name
            .chars()
            .all(|character| character.is_alphanumeric() || character == ' ' || character == '-' || character == '_')
    {
        return Err("Use a profile name with up to 32 letters, numbers, spaces, hyphens, or underscores.".to_string());
    }
    Ok(name.to_string())
}

fn profiles_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = data_dir(app)?.join("profiles");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create the profiles folder: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn list_config_profiles(app: AppHandle) -> Result<Vec<ConfigProfile>, String> {
    let mut profiles = Vec::new();
    for item in fs::read_dir(profiles_dir(&app)?)
        .map_err(|error| format!("Could not read local profiles: {error}"))?
    {
        let item = item.map_err(|error| format!("Could not inspect a profile: {error}"))?;
        if item.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let content = fs::read_to_string(item.path())
            .map_err(|error| format!("Could not read a saved profile: {error}"))?;
        profiles.push(
            serde_json::from_str::<ConfigProfile>(&content)
                .map_err(|error| format!("A saved profile is invalid: {error}"))?,
        );
    }
    profiles.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    Ok(profiles)
}

#[tauri::command]
fn create_config_profile(
    app: AppHandle,
    name: String,
    backup_id: String,
) -> Result<ConfigProfile, String> {
    let name = validate_profile_name(&name)?;
    let backup = saved_backups(&app)?
        .into_iter()
        .find(|backup| backup.id == backup_id)
        .ok_or_else(|| "Create a configuration backup before saving a profile.".to_string())?;
    let profile = ConfigProfile {
        id: unix_millis().to_string(),
        name,
        created_at_ms: unix_millis(),
        backup_id,
        files: backup.files,
    };
    let content = serde_json::to_vec_pretty(&profile)
        .map_err(|error| format!("Could not encode the profile: {error}"))?;
    fs::write(profiles_dir(&app)?.join(format!("{}.json", profile.id)), content)
        .map_err(|error| format!("Could not save the profile: {error}"))?;
    Ok(profile)
}

#[tauri::command]
fn rename_config_profile(
    app: AppHandle,
    profile_id: String,
    name: String,
) -> Result<ConfigProfile, String> {
    if profile_id.is_empty() || !profile_id.chars().all(|character| character.is_ascii_digit()) {
        return Err("The selected profile ID is invalid.".to_string());
    }
    let path = profiles_dir(&app)?.join(format!("{profile_id}.json"));
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the selected profile: {error}"))?;
    let mut profile: ConfigProfile = serde_json::from_str(&content)
        .map_err(|error| format!("The selected profile is invalid: {error}"))?;
    profile.name = validate_profile_name(&name)?;
    let content = serde_json::to_vec_pretty(&profile)
        .map_err(|error| format!("Could not update the profile: {error}"))?;
    fs::write(&path, content)
        .map_err(|error| format!("Could not save the renamed profile: {error}"))?;
    Ok(profile)
}

#[tauri::command]
fn delete_config_profile(app: AppHandle, profile_id: String) -> Result<(), String> {
    if profile_id.is_empty() || !profile_id.chars().all(|character| character.is_ascii_digit()) {
        return Err("The selected profile ID is invalid.".to_string());
    }
    let file = profiles_dir(&app)?.join(format!("{profile_id}.json"));
    if !file.is_file() {
        return Err("The selected profile could not be found.".to_string());
    }
    fs::remove_file(file).map_err(|error| format!("Could not remove the profile: {error}"))
}

#[tauri::command]
fn get_local_data_directory(app: AppHandle) -> Result<String, String> {
    data_dir(&app).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_local_data_folder(app: AppHandle) -> Result<(), String> {
    let path = data_dir(&app)?;
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open File Explorer: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_system_snapshot,
            run_ping_test,
            list_startup_entries,
            list_dns_servers,
            get_active_power_plan,
            scan_temporary_files,
            clean_temporary_files,
            get_cs2_config_status,
            create_config_backup,
            list_config_backups,
            restore_config_backup,
            open_cs2_config_folder,
            load_desktop_settings,
            save_desktop_settings,
            list_config_profiles,
            create_config_profile,
            rename_config_profile,
            delete_config_profile,
            get_local_data_directory,
            open_local_data_folder
        ])
        .run(tauri::generate_context!())
        .expect("CSRIFT desktop application failed to start");
}
