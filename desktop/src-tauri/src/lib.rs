use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::{IpAddr, UdpSocket},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Components, Disks, Networks, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager, State};

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
    running_game_ids: Vec<String>,
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
        let memory_usage_percent = (memory_total_bytes > 0)
            .then(|| (memory_used_bytes as f64 / memory_total_bytes as f64 * 100.0) as f32);

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
            process
                .name()
                .to_string_lossy()
                .eq_ignore_ascii_case("cs2.exe")
        });
        let process_names = system
            .processes()
            .values()
            .map(|process| process.name().to_string_lossy().to_ascii_lowercase())
            .collect::<Vec<_>>();
        let running_game_ids = [
            ("cs2", &["cs2.exe"][..]),
            ("pubg", &["tslgame.exe", "tslgame_be.exe"][..]),
            (
                "valorant",
                &["valorant-win64-shipping.exe", "valorant.exe"][..],
            ),
            (
                "fc-online",
                &[
                    "fconline.exe",
                    "fc online.exe",
                    "fifaonline4.exe",
                    "fifa online 4.exe",
                    "fifa4zf.exe",
                    "fconline_x64.exe",
                ][..],
            ),
        ]
        .into_iter()
        .filter_map(|(game_id, names)| {
            process_names
                .iter()
                .any(|process| names.contains(&process.as_str()))
                .then(|| game_id.to_string())
        })
        .collect();

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
            running_game_ids,
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
    jitter_ms: Option<f64>,
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
            measured_times.push(0.5);
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

fn average_jitter_ms(samples: &[f64]) -> Option<f64> {
    (samples.len() > 1).then(|| {
        samples
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).abs())
            .sum::<f64>()
            / (samples.len() - 1) as f64
    })
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
        let jitter_ms = average_jitter_ms(&measured_latencies);

        Ok(PingResult {
            target,
            sent: 4,
            received,
            packet_loss_percent,
            average_latency_ms,
            jitter_ms,
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
        let registry_roots = [(HKEY_CURRENT_USER, "HKCU"), (HKEY_LOCAL_MACHINE, "HKLM")];
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
            .map_err(|error| {
                format!("Could not inspect the current Windows power plan: {error}")
            })?;
        if !output.status.success() {
            return Err(format!(
                "Windows could not read the active power plan: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let output = String::from_utf8_lossy(&output.stdout);
        let guid = output
            .split_whitespace()
            .map(|token| {
                token.trim_matches(|character: char| {
                    !character.is_ascii_hexdigit() && character != '-'
                })
            })
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
            .and_then(|(_, suffix)| {
                suffix
                    .split_once(')')
                    .map(|(value, _)| value.trim().to_string())
            })
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

const HIGH_PERFORMANCE_PLAN: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const CS2_STEAM_APP_ID: &str = "730";
const GAME_MODE_REGISTRY_KEY: &str = "Software\\Microsoft\\GameBar";
const GAME_MODE_REGISTRY_VALUE: &str = "AutoGameModeEnabled";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameModeBackup {
    was_present: bool,
    value: Option<u32>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cs2OptimizationState {
    game_mode: Option<GameModeBackup>,
    power_plan_guid: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Cs2OptimizationStatus {
    game_mode_enabled: Option<bool>,
    active_power_plan: PowerPlan,
    high_performance_available: bool,
    can_restore_game_mode: bool,
    can_restore_power_plan: bool,
}

fn optimization_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("cs2-optimization-state.json"))
        .map_err(|error| format!("Could not find the CSRIFT data folder: {error}"))
}

fn read_optimization_state(app: &AppHandle) -> Result<Cs2OptimizationState, String> {
    let path = optimization_state_path(app)?;
    if !path.is_file() {
        return Ok(Cs2OptimizationState::default());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Could not read the saved optimization backup: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("The saved optimization backup is invalid: {error}"))
}

fn save_optimization_state(app: &AppHandle, state: &Cs2OptimizationState) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Could not encode the optimization backup: {error}"))?;
    data_dir(app)?;
    fs::write(optimization_state_path(app)?, content)
        .map_err(|error| format!("Could not save the optimization backup: {error}"))
}

#[cfg(target_os = "windows")]
fn read_game_mode_value() -> Result<Option<u32>, String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let user_key = RegKey::predef(HKEY_CURRENT_USER);
    let key = match user_key.open_subkey(GAME_MODE_REGISTRY_KEY) {
        Ok(key) => key,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not read the Windows Game Mode setting: {error}"
            ))
        }
    };
    match key.get_value::<u32, _>(GAME_MODE_REGISTRY_VALUE) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Could not read the Windows Game Mode setting: {error}"
        )),
    }
}

#[cfg(target_os = "windows")]
fn write_game_mode_value(value: Option<u32>) -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(GAME_MODE_REGISTRY_KEY)
        .map_err(|error| format!("Could not access the current-user Game Mode setting: {error}"))?;
    if let Some(value) = value {
        key.set_value(GAME_MODE_REGISTRY_VALUE, &value)
            .map_err(|error| format!("Could not enable Windows Game Mode: {error}"))
    } else {
        match key.delete_value(GAME_MODE_REGISTRY_VALUE) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Could not restore the Windows Game Mode setting: {error}"
            )),
        }
    }
}

fn high_performance_plan_available() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powercfg.exe")
            .arg("/list")
            .output()
            .map_err(|error| format!("Could not inspect Windows power plans: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Windows could not list power plans: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        return Ok(String::from_utf8_lossy(&output.stdout)
            .to_ascii_lowercase()
            .contains(HIGH_PERFORMANCE_PLAN));
    }

    #[cfg(not(target_os = "windows"))]
    Err("Windows power plans are supported only on Windows.".to_string())
}

fn set_power_plan(guid: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powercfg.exe")
            .args(["/setactive", guid])
            .output()
            .map_err(|error| format!("Could not change the Windows power plan: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Windows could not change the power plan: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = guid;
        Err("Windows power plans are supported only on Windows.".to_string())
    }
}

#[tauri::command]
fn get_cs2_optimization_status(app: AppHandle) -> Result<Cs2OptimizationStatus, String> {
    let state = read_optimization_state(&app)?;
    let game_mode_enabled = {
        #[cfg(target_os = "windows")]
        {
            read_game_mode_value()?.map(|value| value != 0)
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    };
    Ok(Cs2OptimizationStatus {
        game_mode_enabled,
        active_power_plan: get_active_power_plan()?,
        high_performance_available: high_performance_plan_available()?,
        can_restore_game_mode: state.game_mode.is_some(),
        can_restore_power_plan: state.power_plan_guid.is_some(),
    })
}

#[tauri::command]
fn apply_cs2_optimization(app: AppHandle, setting: String) -> Result<(), String> {
    let mut state = read_optimization_state(&app)?;
    match setting.as_str() {
        "gameMode" => {
            #[cfg(target_os = "windows")]
            {
                let current = read_game_mode_value()?;
                if current == Some(1) {
                    return Ok(());
                }
                let created_backup = state.game_mode.is_none();
                if state.game_mode.is_none() {
                    state.game_mode = Some(GameModeBackup {
                        was_present: current.is_some(),
                        value: current,
                    });
                    save_optimization_state(&app, &state)?;
                }
                if let Err(error) = write_game_mode_value(Some(1)) {
                    if created_backup {
                        state.game_mode = None;
                        save_optimization_state(&app, &state)?;
                    }
                    return Err(error);
                }
                Ok(())
            }
            #[cfg(not(target_os = "windows"))]
            Err("Windows Game Mode is supported only on Windows.".to_string())
        }
        "powerPlan" => {
            let current = get_active_power_plan()?.guid.ok_or_else(|| {
                "The current Windows power plan could not be identified.".to_string()
            })?;
            if current.eq_ignore_ascii_case(HIGH_PERFORMANCE_PLAN) {
                return Ok(());
            }
            if !high_performance_plan_available()? {
                return Err("The built-in High performance plan is not available on this PC. CSRIFT will not create or alter a power plan.".to_string());
            }
            let created_backup = state.power_plan_guid.is_none();
            if state.power_plan_guid.is_none() {
                state.power_plan_guid = Some(current);
                save_optimization_state(&app, &state)?;
            }
            if let Err(error) = set_power_plan(HIGH_PERFORMANCE_PLAN) {
                if created_backup {
                    state.power_plan_guid = None;
                    save_optimization_state(&app, &state)?;
                }
                return Err(error);
            }
            Ok(())
        }
        _ => Err("Choose a supported CS2 optimization setting.".to_string()),
    }
}

#[tauri::command]
fn restore_cs2_optimization(app: AppHandle, setting: String) -> Result<(), String> {
    let mut state = read_optimization_state(&app)?;
    match setting.as_str() {
        "gameMode" => {
            let backup = state
                .game_mode
                .clone()
                .ok_or_else(|| "There is no saved Game Mode change to restore.".to_string())?;
            #[cfg(target_os = "windows")]
            {
                let current = read_game_mode_value()?;
                if current != Some(1) && current != backup.value {
                    return Err("Windows Game Mode changed outside CSRIFT after optimization. Review it in Windows Settings; CSRIFT left the current value untouched.".to_string());
                }
                if current != backup.value {
                    write_game_mode_value(if backup.was_present {
                        backup.value
                    } else {
                        None
                    })?;
                }
                state.game_mode = None;
                save_optimization_state(&app, &state)
            }
            #[cfg(not(target_os = "windows"))]
            Err("Windows Game Mode is supported only on Windows.".to_string())
        }
        "powerPlan" => {
            let previous = state
                .power_plan_guid
                .clone()
                .ok_or_else(|| "There is no saved power-plan change to restore.".to_string())?;
            let current = get_active_power_plan()?.guid.ok_or_else(|| {
                "The current Windows power plan could not be identified.".to_string()
            })?;
            if current.eq_ignore_ascii_case(&previous) {
                state.power_plan_guid = None;
                return save_optimization_state(&app, &state);
            }
            if !current.eq_ignore_ascii_case(HIGH_PERFORMANCE_PLAN) {
                return Err("The active power plan changed outside CSRIFT after optimization. CSRIFT left the current plan untouched.".to_string());
            }
            set_power_plan(&previous)?;
            state.power_plan_guid = None;
            save_optimization_state(&app, &state)
        }
        _ => Err("Choose a supported CS2 optimization setting.".to_string()),
    }
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
        return Err(
            "No eligible temporary files could be removed; they may be in use.".to_string(),
        );
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

fn vdf_values(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '"' {
            continue;
        }
        let mut value = String::new();
        while let Some(character) = characters.next() {
            match character {
                '\\' => {
                    if let Some(escaped) = characters.next() {
                        value.push(escaped);
                    }
                }
                '"' => break,
                value_character => value.push(value_character),
            }
        }
        values.push(value);
    }
    values
}

fn parse_steam_library_paths(contents: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for line in contents.lines() {
        let values = vdf_values(line);
        if values.len() >= 2 && (values[0] == "path" || values[0].parse::<u32>().is_ok()) {
            paths.push(PathBuf::from(&values[1]));
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

fn steam_libraries(steam_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut libraries = Vec::new();
    for steam_dir in steam_dirs {
        libraries.push(steam_dir.clone());
        let library_file = steam_dir.join("steamapps").join("libraryfolders.vdf");
        let Ok(contents) = fs::read_to_string(library_file) else {
            continue;
        };
        libraries.extend(parse_steam_library_paths(&contents));
    }
    libraries.retain(|path| path.is_dir());
    libraries.sort();
    libraries.dedup();
    libraries
}

fn parse_app_manifest_install_dir(manifest: &str, app_id: u32) -> Option<String> {
    let mut app_id_matches = false;
    let mut is_installed = false;
    let mut install_dir = None;
    for line in manifest.lines() {
        let values = vdf_values(line);
        if values.len() >= 2 {
            match values[0].as_str() {
                "appid" => app_id_matches = values[1] == app_id.to_string(),
                "StateFlags" => {
                    is_installed = values[1].parse::<u32>().is_ok_and(|flags| flags & 4 != 0)
                }
                "installdir" => install_dir = Some(values[1].clone()),
                _ => {}
            }
        }
    }
    (app_id_matches && is_installed)
        .then_some(install_dir)
        .flatten()
}

fn app_manifest_install_dir_for_app(library: &Path, app_id: u32) -> Option<String> {
    let manifest = fs::read_to_string(
        library
            .join("steamapps")
            .join(format!("appmanifest_{app_id}.acf")),
    )
    .ok()?;
    parse_app_manifest_install_dir(&manifest, app_id)
}

fn app_manifest_install_dir(library: &Path) -> Option<String> {
    app_manifest_install_dir_for_app(library, 730)
}

fn cs2_executable(path: &Path) -> Option<PathBuf> {
    [
        path.join("game").join("bin").join("win64").join("cs2.exe"),
        path.join("bin").join("win64").join("cs2.exe"),
        path.join("cs2.exe"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn stored_game_path(app: &AppHandle) -> Option<PathBuf> {
    let file = app.path().app_data_dir().ok()?.join("game-install.json");
    let contents = fs::read_to_string(file).ok()?;
    serde_json::from_str::<String>(&contents)
        .ok()
        .map(PathBuf::from)
}

fn save_game_path(app: &AppHandle, path: &Path) -> Result<(), String> {
    let encoded = serde_json::to_vec_pretty(&path.to_string_lossy().to_string())
        .map_err(|error| format!("Could not encode the CS2 installation path: {error}"))?;
    fs::write(data_dir(app)?.join("game-install.json"), encoded)
        .map_err(|error| format!("Could not save the CS2 installation path: {error}"))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameDetection {
    detected: bool,
    install_path: Option<String>,
    steam_paths: Vec<String>,
    library_paths: Vec<String>,
    executable_found: bool,
    config_files: Vec<String>,
    launch_options_found: bool,
    steam_running: bool,
    source: Option<String>,
}

fn game_config_files() -> Vec<String> {
    let Some(directory) = find_cs2_config_dir() else {
        return Vec::new();
    };
    config_files(&directory)
}

fn has_cs2_launch_options(contents: &str) -> bool {
    let mut in_app = false;
    let mut app_depth = 0i32;
    for line in contents.lines() {
        let values = vdf_values(line);
        if !in_app && values.first().is_some_and(|key| key == "730") {
            in_app = true;
        }
        let has_options = in_app
            && values.len() >= 2
            && values[0] == "LaunchOptions"
            && !values[1].trim().is_empty();
        if in_app {
            let previous_depth = app_depth;
            app_depth += line.chars().filter(|character| *character == '{').count() as i32;
            app_depth -= line.chars().filter(|character| *character == '}').count() as i32;
            if app_depth < 0 || (previous_depth > 0 && app_depth == 0) {
                in_app = false;
                app_depth = 0;
            }
        }
        if has_options {
            return true;
        }
    }
    false
}

fn launch_options_found(steam_dirs: &[PathBuf]) -> bool {
    steam_dirs.iter().any(|steam_dir| {
        let userdata = steam_dir.join("userdata");
        let Ok(users) = fs::read_dir(userdata) else {
            return false;
        };
        users.flatten().any(|user| {
            fs::read_to_string(user.path().join("config").join("localconfig.vdf"))
                .map(|contents| has_cs2_launch_options(&contents))
                .unwrap_or(false)
        })
    })
}

fn steam_is_running() -> bool {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system.processes().values().any(|process| {
        process
            .name()
            .to_string_lossy()
            .eq_ignore_ascii_case("steam.exe")
    })
}

fn detect_cs2(
    app: &AppHandle,
    manual_path: Option<String>,
    show_progress: bool,
) -> Result<GameDetection, String> {
    if show_progress {
        app.emit(
            "game-detection-progress",
            ScanProgress {
                step: "SEARCHING FOR STEAM".to_string(),
                percent: 10,
            },
        )
        .map_err(|error| format!("Could not update game detection progress: {error}"))?;
    }
    let steam_dirs = steam_directories();
    if show_progress {
        app.emit(
            "game-detection-progress",
            ScanProgress {
                step: "CHECKING GAME LIBRARIES".to_string(),
                percent: 35,
            },
        )
        .map_err(|error| format!("Could not update game detection progress: {error}"))?;
    }
    let libraries = steam_libraries(&steam_dirs);
    if show_progress {
        app.emit(
            "game-detection-progress",
            ScanProgress {
                step: "LOCATING COUNTER-STRIKE 2".to_string(),
                percent: 62,
            },
        )
        .map_err(|error| format!("Could not update game detection progress: {error}"))?;
    }
    let manual_selection = manual_path.is_some();
    let selected_path = if let Some(path) = manual_path {
        Some((PathBuf::from(path), "MANUAL"))
    } else {
        stored_game_path(app).map(|path| (path, "SAVED"))
    }
    .filter(|(path, _)| path.is_dir());

    let mut candidate = selected_path.map(|(path, source)| (path, source.to_string()));
    if candidate.is_none() && !manual_selection {
        for library in &libraries {
            let Some(install_dir) = app_manifest_install_dir(library) else {
                continue;
            };
            let path = library.join("steamapps").join("common").join(install_dir);
            if path.is_dir() {
                candidate = Some((path, "STEAM LIBRARY".to_string()));
                break;
            }
        }
    }

    if show_progress {
        app.emit(
            "game-detection-progress",
            ScanProgress {
                step: "VERIFYING INSTALLATION".to_string(),
                percent: 84,
            },
        )
        .map_err(|error| format!("Could not update game detection progress: {error}"))?;
    }
    let installation = candidate.filter(|(path, _)| cs2_executable(path).is_some());
    if show_progress {
        if let Some((path, _)) = &installation {
            save_game_path(app, path)?;
        }
    }
    let config_files = game_config_files();
    Ok(GameDetection {
        detected: installation.is_some(),
        install_path: installation
            .as_ref()
            .map(|(path, _)| path.to_string_lossy().into_owned()),
        steam_paths: steam_dirs
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        library_paths: libraries
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        executable_found: installation
            .as_ref()
            .and_then(|(path, _)| cs2_executable(path))
            .is_some(),
        config_files,
        launch_options_found: launch_options_found(&steam_dirs),
        steam_running: steam_is_running(),
        source: installation.as_ref().map(|(_, source)| source.clone()),
    })
}

#[tauri::command]
fn detect_cs2_installation(
    app: AppHandle,
    manual_path: Option<String>,
) -> Result<GameDetection, String> {
    let detection = detect_cs2(&app, manual_path, true)?;
    app.emit(
        "game-detection-progress",
        ScanProgress {
            step: "DETECTION COMPLETE".to_string(),
            percent: 100,
        },
    )
    .map_err(|error| format!("Could not finish game detection progress: {error}"))?;
    Ok(detection)
}

#[tauri::command]
fn launch_cs2_game(app: AppHandle) -> Result<(), String> {
    let detection = detect_cs2(&app, None, false)?;
    let install_path = detection.install_path.ok_or_else(|| {
        "Counter-Strike 2 was not verified. Find the game installation before launching."
            .to_string()
    })?;
    let install_path = PathBuf::from(install_path);
    if cs2_executable(&install_path).is_none() {
        return Err(
            "The verified CS2 executable is no longer available. Run Game Detection again."
                .to_string(),
        );
    }

    let steam_executable = steam_directories()
        .into_iter()
        .map(|directory| directory.join("steam.exe"))
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Steam was not found. Install or repair Steam, then run Game Detection again."
                .to_string()
        })?;
    let steam_directory = steam_executable
        .parent()
        .ok_or_else(|| "The Steam installation path is invalid.".to_string())?;
    Command::new(&steam_executable)
        .current_dir(steam_directory)
        .args(["-applaunch", CS2_STEAM_APP_ID])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not ask Steam to launch Counter-Strike 2: {error}"))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledSteamGame {
    app_id: u32,
    install_path: String,
}

fn safe_steam_install_directory(value: &str) -> bool {
    !value.trim().is_empty()
        && Path::new(value).is_relative()
        && Path::new(value)
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

#[tauri::command]
fn detect_installed_steam_games(app_ids: Vec<u32>) -> Result<Vec<InstalledSteamGame>, String> {
    if app_ids.len() > 100_000 || app_ids.contains(&0) {
        return Err("Steam game detection received an invalid App ID list.".to_string());
    }
    let app_ids = app_ids
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }
    let libraries = steam_libraries(&steam_directories());
    let mut installed = Vec::new();
    for library in libraries {
        let steamapps = library.join("steamapps");
        let entries = match fs::read_dir(&steamapps) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let Some(app_id) = file_name
                .strip_prefix("appmanifest_")
                .and_then(|name| name.strip_suffix(".acf"))
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|app_id| app_ids.contains(app_id))
            else {
                continue;
            };
            let Ok(manifest) = fs::read_to_string(entry.path()) else {
                continue;
            };
            let Some(install_dir) = parse_app_manifest_install_dir(&manifest, app_id) else {
                continue;
            };
            if !safe_steam_install_directory(&install_dir) {
                continue;
            }
            let path = steamapps.join("common").join(install_dir);
            if path.is_dir() {
                installed.push(InstalledSteamGame {
                    app_id,
                    install_path: path.to_string_lossy().into_owned(),
                });
            }
        }
    }
    installed.sort_by_key(|game| game.app_id);
    installed.dedup_by_key(|game| game.app_id);
    Ok(installed)
}

#[tauri::command]
fn list_installed_steam_games() -> Result<Vec<InstalledSteamGame>, String> {
    let mut app_ids = std::collections::HashSet::new();
    for library in steam_libraries(&steam_directories()) {
        let entries = match fs::read_dir(library.join("steamapps")) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if let Some(app_id) = file_name
                .strip_prefix("appmanifest_")
                .and_then(|name| name.strip_suffix(".acf"))
                .and_then(|value| value.parse::<u32>().ok())
            {
                app_ids.insert(app_id);
            }
        }
    }
    detect_installed_steam_games(app_ids.into_iter().collect())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedGameInstallation {
    game_id: String,
    install_path: String,
    executable_path: String,
    source: String,
}

fn game_executable_names(game_id: &str) -> Option<&'static [&'static str]> {
    match game_id {
        "cs2" => Some(&["cs2.exe"]),
        "pubg" => Some(&["tslgame.exe"]),
        "valorant" => Some(&["valorant-win64-shipping.exe"]),
        "fc-online" => Some(&[
            "fconline.exe",
            "fc online.exe",
            "fifaonline4.exe",
            "fifa online 4.exe",
            "fifa4zf.exe",
            "fconline_x64.exe",
        ]),
        _ => None,
    }
}

fn game_executable_name_matches(game_id: &str, file_name: &str) -> bool {
    game_executable_names(game_id).is_some_and(|names| {
        names
            .iter()
            .any(|name| file_name.eq_ignore_ascii_case(name))
    })
}

fn executable_matches_game(game_id: &str, path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| game_executable_name_matches(game_id, name))
}

fn game_executable_relative_paths(game_id: &str) -> &'static [&'static str] {
    match game_id {
        "cs2" => &["game/bin/win64/cs2.exe", "bin/win64/cs2.exe", "cs2.exe"],
        "pubg" => &[
            "TslGame/Binaries/Win64/TslGame.exe",
            "Binaries/Win64/TslGame.exe",
            "TslGame.exe",
        ],
        "valorant" => &[
            "live/ShooterGame/Binaries/Win64/VALORANT-Win64-Shipping.exe",
            "ShooterGame/Binaries/Win64/VALORANT-Win64-Shipping.exe",
            "VALORANT-Win64-Shipping.exe",
        ],
        "fc-online" => &[
            "FCOnline.exe",
            "FIFAOnline4.exe",
            "FIFA4zf.exe",
            "FCOnline_x64.exe",
            "FC Online.exe",
            "FIFA ONLINE 4.exe",
            "Game/FCOnline.exe",
            "Game/FIFAOnline4.exe",
            "Game/FIFA ONLINE 4.exe",
            "Game/FIFA4zf.exe",
        ],
        _ => &[],
    }
}

fn game_installation_from_executable(
    game_id: &str,
    executable: &Path,
    source: &str,
) -> Option<ManagedGameInstallation> {
    if !executable_matches_game(game_id, executable) {
        return None;
    }
    Some(ManagedGameInstallation {
        game_id: game_id.to_string(),
        install_path: executable.parent()?.to_string_lossy().into_owned(),
        executable_path: executable.to_string_lossy().into_owned(),
        source: source.to_string(),
    })
}

fn find_game_executable(game_id: &str, roots: &[PathBuf]) -> Option<PathBuf> {
    for root in roots {
        for relative in game_executable_relative_paths(game_id) {
            let candidate = root.join(relative);
            if executable_matches_game(game_id, &candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn known_non_steam_game_roots(game_id: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for env_key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(value) = std::env::var_os(env_key) {
            let base = PathBuf::from(value);
            match game_id {
                "valorant" => roots.push(base.join("Riot Games").join("VALORANT")),
                "fc-online" => {
                    roots.push(base.join("Nexon").join("EA SPORTS FC ONLINE"));
                    roots.push(base.join("Nexon").join("FIFA ONLINE 4"));
                }
                _ => {}
            }
        }
    }
    if game_id == "fc-online" {
        if let Some(value) = std::env::var_os("SystemDrive") {
            let root = PathBuf::from(format!(
                "{}\\Nexon",
                value.to_string_lossy().trim_end_matches('\\')
            ));
            roots.push(root.join("EA SPORTS FC ONLINE"));
            roots.push(root.join("FIFA ONLINE 4"));
        }
        if let Some(value) = std::env::var_os("PUBLIC") {
            let root = PathBuf::from(value).join("Nexon");
            roots.push(root.join("EA SPORTS FC ONLINE"));
            roots.push(root.join("FIFA ONLINE 4"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        use winreg::{enums::*, RegKey};
        let registry_paths = match game_id {
            "valorant" => &[
                (
                    r"Software\Riot Games\Riot Client",
                    &["InstallPath", "InstallDir"][..],
                ),
                (
                    r"Software\WOW6432Node\Riot Games\Riot Client",
                    &["InstallPath", "InstallDir"][..],
                ),
            ][..],
            "fc-online" => &[
                (
                    r"Software\Nexon\EA SPORTS FC ONLINE",
                    &[
                        "InstallPath",
                        "InstallDir",
                        "InstallLocation",
                        "Install_Dir",
                        "GamePath",
                        "Path",
                    ][..],
                ),
                (
                    r"Software\Nexon\FIFA ONLINE 4",
                    &[
                        "InstallPath",
                        "InstallDir",
                        "InstallLocation",
                        "Install_Dir",
                        "GamePath",
                        "Path",
                    ][..],
                ),
                (
                    r"Software\WOW6432Node\Nexon\EA SPORTS FC ONLINE",
                    &[
                        "InstallPath",
                        "InstallDir",
                        "InstallLocation",
                        "Install_Dir",
                        "GamePath",
                        "Path",
                    ][..],
                ),
                (
                    r"Software\WOW6432Node\Nexon\FIFA ONLINE 4",
                    &[
                        "InstallPath",
                        "InstallDir",
                        "InstallLocation",
                        "Install_Dir",
                        "GamePath",
                        "Path",
                    ][..],
                ),
            ][..],
            _ => &[],
        };
        for root_key in [
            RegKey::predef(HKEY_CURRENT_USER),
            RegKey::predef(HKEY_LOCAL_MACHINE),
        ] {
            for (key_path, value_names) in registry_paths {
                if let Ok(key) = root_key.open_subkey(key_path) {
                    for value_name in *value_names {
                        if let Ok(value) = key.get_value::<String, _>(value_name) {
                            roots.push(PathBuf::from(value));
                        }
                    }
                }
            }
        }
    }

    roots.retain(|root| root.is_dir());
    roots.sort();
    roots.dedup();
    roots
}

#[tauri::command]
fn detect_managed_game_installations(
    manual_paths: std::collections::HashMap<String, String>,
) -> Result<Vec<ManagedGameInstallation>, String> {
    let mut installations = Vec::new();
    let mut verified_manual_ids = std::collections::HashSet::new();
    for (game_id, executable_path) in &manual_paths {
        if game_executable_names(game_id).is_none() {
            return Err(format!("Unsupported game identifier: {game_id}"));
        }
        let executable = PathBuf::from(executable_path);
        if let Some(installation) =
            game_installation_from_executable(game_id, &executable, "MANUAL")
        {
            verified_manual_ids.insert(game_id.clone());
            installations.push(installation);
        }
    }

    let steam_games = detect_installed_steam_games(vec![730, 578080])?;
    for steam_game in steam_games {
        let game_id = match steam_game.app_id {
            730 => "cs2",
            578080 => "pubg",
            _ => continue,
        };
        if verified_manual_ids.contains(game_id) {
            continue;
        }
        if let Some(executable) =
            find_game_executable(game_id, &[PathBuf::from(&steam_game.install_path)])
        {
            if let Some(installation) =
                game_installation_from_executable(game_id, &executable, "STEAM")
            {
                installations.push(installation);
            }
        }
    }

    for game_id in ["valorant", "fc-online"] {
        if verified_manual_ids.contains(game_id) {
            continue;
        }
        let roots = known_non_steam_game_roots(game_id);
        if let Some(executable) = find_game_executable(game_id, &roots) {
            if let Some(installation) = game_installation_from_executable(
                game_id,
                &executable,
                if game_id == "valorant" {
                    "RIOT"
                } else {
                    "NEXON"
                },
            ) {
                installations.push(installation);
            }
        }
    }

    installations.sort_by(|left, right| left.game_id.cmp(&right.game_id));
    installations.dedup_by(|left, right| left.game_id == right.game_id);
    Ok(installations)
}

#[tauri::command]
fn pick_managed_game_executable(game_id: String) -> Result<Option<String>, String> {
    let names = game_executable_names(&game_id)
        .ok_or_else(|| format!("Unsupported game identifier: {game_id}"))?;
    #[cfg(target_os = "windows")]
    {
        let title = match game_id.as_str() {
            "cs2" => "Select cs2.exe",
            "pubg" => "Select TslGame.exe",
            "valorant" => "Select VALORANT-Win64-Shipping.exe",
            "fc-online" => "Select the EA SPORTS FC ONLINE game executable",
            _ => "Select game executable",
        };
        let script = format!(
            "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title = '{}'; $dialog.Filter = 'Game executable (*.exe)|*.exe'; $dialog.CheckFileExists = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Write($dialog.FileName) }}",
            title.replace('\'', "''")
        );
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-STA", "-Command", &script])
            .output()
            .map_err(|error| format!("Could not open the game executable picker: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "The executable picker failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            return Ok(None);
        }
        if !names.iter().any(|name| {
            Path::new(&path)
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|file_name| file_name.eq_ignore_ascii_case(name))
        }) {
            return Err(format!("That executable is not recognized as {game_id}."));
        }
        return Ok(Some(path));
    }
    #[cfg(not(target_os = "windows"))]
    Err("The game executable picker is only available on Windows.".to_string())
}

#[tauri::command]
fn launch_managed_game(
    app: AppHandle,
    game_id: String,
    executable_path: String,
) -> Result<(), String> {
    if game_id == "cs2" {
        return launch_cs2_game(app);
    }
    let executable = PathBuf::from(&executable_path);
    if !executable_matches_game(&game_id, &executable) {
        return Err(format!(
            "The saved {game_id} executable is missing or could not be verified."
        ));
    }
    let mut command = Command::new(&executable);
    if game_id == "valorant" {
        let riot_client = known_non_steam_game_roots("valorant")
            .into_iter()
            .map(|root| {
                root.join("..")
                    .join("Riot Client")
                    .join("RiotClientServices.exe")
            })
            .find(|path| path.is_file())
            .ok_or_else(|| {
                "Riot Client was not found. Open VALORANT from Riot Client.".to_string()
            })?;
        command = Command::new(riot_client);
        command.args(["--launch-product=valorant", "--launch-patchline=live"]);
    } else {
        let directory = executable
            .parent()
            .ok_or_else(|| "The game executable has no installation directory.".to_string())?;
        command.current_dir(directory);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start the game launcher: {error}"))
}

#[tauri::command]
fn pick_cs2_installation_directory() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Select the Counter-Strike 2 installation folder'; $dialog.ShowNewFolderButton = $false; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }";
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-STA", "-Command", script])
            .output()
            .map_err(|error| format!("Could not open the folder picker: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "The folder picker failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!path.is_empty()).then_some(path));
    }
    #[cfg(not(target_os = "windows"))]
    Err("The CS2 folder picker is only available on Windows.".to_string())
}

#[derive(Default)]
struct ScanCancellation(Arc<AtomicBool>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    step: String,
    percent: u8,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanFinding {
    label: String,
    status: String,
    detail: String,
    recommendation: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanReport {
    completed_at_ms: u128,
    duration_ms: u128,
    findings: Vec<ScanFinding>,
    good_count: usize,
    attention_count: usize,
    unsupported_count: usize,
}

fn emit_scan_progress(app: &AppHandle, step: &str, percent: u8) -> Result<(), String> {
    app.emit(
        "hawk-eye-progress",
        ScanProgress {
            step: step.to_string(),
            percent,
        },
    )
    .map_err(|error| format!("Could not update scan progress: {error}"))
}

fn scan_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) {
        Err("SCAN_CANCELLED".to_string())
    } else {
        Ok(())
    }
}

fn finding(label: &str, status: &str, detail: String, recommendation: &str) -> ScanFinding {
    ScanFinding {
        label: label.to_string(),
        status: status.to_string(),
        detail,
        recommendation: recommendation.to_string(),
    }
}

fn active_network_route(ipv4: bool) -> Option<String> {
    let address = if ipv4 {
        "1.1.1.1:53"
    } else {
        "[2606:4700:4700::1111]:53"
    };
    let address = address.parse::<std::net::SocketAddr>().ok()?;
    let socket = UdpSocket::bind(if ipv4 { "0.0.0.0:0" } else { "[::]:0" }).ok()?;
    socket.connect(address).ok()?;
    let local = socket.local_addr().ok()?.ip();
    (!local.is_unspecified()).then(|| local.to_string())
}

fn ping_once(target: &str, ipv4: bool) -> Result<(bool, Option<f64>, String), String> {
    let mut command = Command::new("ping.exe");
    command.args(["-n", "1", "-w", "1200"]);
    command.arg(if ipv4 { "-4" } else { "-6" });
    let output = command
        .arg(target)
        .output()
        .map_err(|error| format!("Could not start the Windows ping utility: {error}"))?;
    if !output.status.success() && output.stdout.is_empty() {
        return Err(format!(
            "The Windows ping utility failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let response = String::from_utf8_lossy(&output.stdout);
    let (replies, displayed, measured) = parse_ping_output(&response);
    let detail = displayed
        .first()
        .cloned()
        .unwrap_or_else(|| "No reply (timeout or network policy)".to_string());
    Ok((replies > 0, measured.first().copied(), detail))
}

fn wait_for_scan_interval(cancelled: &AtomicBool, duration: Duration) -> Result<(), String> {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        scan_cancelled(cancelled)?;
        thread::sleep(
            Duration::from_millis(25).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
    scan_cancelled(cancelled)
}

fn latest_backup_readonly(app: &AppHandle) -> Result<Option<(ConfigBackup, PathBuf)>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not find the CSRIFT data folder: {error}"))?
        .join("backups");
    if !root.is_dir() {
        return Ok(None);
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("Could not inspect local CS2 backups: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not inspect a local backup: {error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Could not inspect a local backup: {error}"))?
            .is_dir()
        {
            continue;
        }
        let backup_dir = entry.path();
        let manifest = backup_dir.join("manifest.json");
        if !manifest.is_file() {
            continue;
        }
        let content = fs::read_to_string(&manifest)
            .map_err(|error| format!("Could not read a local backup manifest: {error}"))?;
        let backup: ConfigBackup = serde_json::from_str(&content)
            .map_err(|error| format!("A local backup manifest is invalid: {error}"))?;
        backups.push((backup, backup_dir));
    }
    backups.sort_by(|left, right| right.0.created_at_ms.cmp(&left.0.created_at_ms));
    Ok(backups.into_iter().next())
}

#[cfg(target_os = "windows")]
fn gpu_device_names() -> Vec<String> {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    let path = "SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
    let Ok(class_key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) else {
        return Vec::new();
    };
    let mut names = class_key
        .enum_keys()
        .flatten()
        .filter_map(|subkey| class_key.open_subkey(subkey).ok())
        .filter_map(|key| key.get_value::<String, _>("DriverDesc").ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

#[cfg(not(target_os = "windows"))]
fn gpu_device_names() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
async fn run_hawk_eye_scan(
    app: AppHandle,
    cancellation: State<'_, ScanCancellation>,
) -> Result<ScanReport, String> {
    let cancelled = cancellation.0.clone();
    cancelled.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let scan_started = Instant::now();
        let mut findings = Vec::new();
        scan_cancelled(&cancelled)?;
        emit_scan_progress(&app, "INITIALIZING SCAN", 3)?;
        let steam_running = steam_is_running();

        scan_cancelled(&cancelled)?;
        emit_scan_progress(&app, "ANALYZING GAME FILES", 12)?;
        let detection = detect_cs2(&app, None, false)?;
        findings.push(finding(
            "CS2 INSTALLATION",
            if detection.detected { "GOOD" } else { "NEEDS ATTENTION" },
            detection.install_path.clone().unwrap_or_else(|| "No verified CS2 executable was found in the Steam libraries.".to_string()),
            if detection.detected { "Installation path and executable were verified locally." } else { "Install CS2 through Steam or choose its verified installation folder." },
        ));
        findings.push(finding(
            "STEAM CLIENT",
            if steam_running { "GOOD" } else { "NEEDS ATTENTION" },
            if steam_running { "Steam is currently running." } else { "Steam is not currently running." }.to_string(),
            "Open Steam before launching CS2. No running game process is inspected or modified.",
        ));
        let steam_dirs = steam_directories();
        let options_found = launch_options_found(&steam_dirs);
        findings.push(finding(
            "CS2 LAUNCH OPTIONS",
            "GOOD",
            if options_found { "A non-empty launch option entry was found for CS2 in a local Steam profile.".to_string() } else { "No custom CS2 launch options were found; Steam defaults may apply.".to_string() },
            "Launch options are user-specific. Review them in Steam; CSRIFT does not add or remove options.",
        ));

        scan_cancelled(&cancelled)?;
        emit_scan_progress(&app, "CHECKING CONFIGURATION", 25)?;
        let config_dir = find_cs2_config_dir();
        let accessible_files = config_dir.as_ref().map(|directory| config_files(directory)).unwrap_or_default();
        let config_available = config_dir.as_ref().is_some_and(|directory| fs::read_dir(directory).is_ok());
        let mut config_bytes = 0u64;
        let mut unreadable_files = Vec::new();
        if let Some(directory) = config_dir.as_ref().filter(|_| config_available) {
            for name in &accessible_files {
                scan_cancelled(&cancelled)?;
                match fs::read(directory.join(name)) {
                    Ok(contents) => config_bytes = config_bytes.saturating_add(contents.len() as u64),
                    Err(error) => unreadable_files.push(format!("{name}: {error}")),
                }
            }
        }
        findings.push(finding(
            "CS2 CONFIGURATION",
            if !config_available { "NOT SUPPORTED" } else if accessible_files.is_empty() || !unreadable_files.is_empty() { "NEEDS ATTENTION" } else { "GOOD" },
            if !config_available {
                "No readable Steam userdata / 730 / local / cfg folder was found.".to_string()
            } else if !unreadable_files.is_empty() {
                format!("{} supported file(s), {} bytes read. Could not read: {}", accessible_files.len(), config_bytes, unreadable_files.join("; "))
            } else {
                format!("{} supported .cfg / .vcfg file(s), {} bytes read from disk.", accessible_files.len(), config_bytes)
            },
            "Create a local CSRIFT backup before changing supported configuration files.",
        ));
        scan_cancelled(&cancelled)?;
        let latest_backup = latest_backup_readonly(&app)?;
        let backup_comparison = if let (Some(directory), Some((backup, backup_dir))) =
            (config_dir.as_ref().filter(|_| config_available), latest_backup.as_ref())
        {
            let mut changed_files = Vec::new();
            let mut unavailable_files = Vec::new();
            for name in &backup.files {
                if !accessible_files.contains(name) {
                    changed_files.push(name.clone());
                }
            }
            for name in &accessible_files {
                scan_cancelled(&cancelled)?;
                match (
                    fs::read(directory.join(name)),
                    fs::read(backup_dir.join(name)),
                ) {
                    (Ok(current), Ok(saved)) if current != saved => changed_files.push(name.clone()),
                    (Ok(_), Ok(_)) => {}
                    (_, Err(error)) => unavailable_files.push(format!("{name}: saved copy {error}")),
                    (Err(error), _) => unavailable_files.push(format!("{name}: current file {error}")),
                }
            }
            Some((backup.id.clone(), changed_files, unavailable_files))
        } else {
            None
        };
        let backup_available = backup_comparison.is_some();
        let backup_detail = match backup_comparison {
            Some((id, changed, unreadable)) if unreadable.is_empty() && changed.is_empty() => {
                format!("All readable CS2 settings match local backup {id}.")
            }
            Some((id, changed, unreadable)) if unreadable.is_empty() => {
                format!("Compared with local backup {id}; {} file(s) differ: {}.", changed.len(), changed.join(", "))
            }
            Some((id, changed, unreadable)) => format!(
                "Compared with local backup {id}; {} file(s) differ, and {} comparison(s) were unavailable: {}.",
                changed.len(),
                unreadable.len(),
                unreadable.join("; ")
            ),
            None if config_available => "No existing CSRIFT backup was found. The scan did not create one.".to_string(),
            None => "A local CS2 settings directory is required before CSRIFT can verify a backup.".to_string(),
        };
        findings.push(finding(
            "BACKUP READINESS",
            if !config_available { "NOT SUPPORTED" } else if backup_available { "GOOD" } else { "NEEDS ATTENTION" },
            backup_detail,
            "Create a backup separately; scanning never writes files or tests write access.",
        ));

        scan_cancelled(&cancelled)?;
        emit_scan_progress(&app, "ANALYZING SYSTEM ENVIRONMENT", 43)?;
        let mut system = System::new_all();
        system.refresh_cpu_all();
        thread::sleep(Duration::from_millis(220));
        system.refresh_cpu_all();
        system.refresh_memory();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let cpu = system.cpus().first().map(|cpu| cpu.brand().trim().to_string()).unwrap_or_default();
        let memory_total = system.total_memory();
        let memory_used = system.used_memory();
        let cpu_usage = if system.cpus().is_empty() {
            "load unavailable".to_string()
        } else {
            format!(
                "{:.0}% average load",
                system.cpus().iter().map(|cpu| cpu.cpu_usage()).sum::<f32>()
                    / system.cpus().len() as f32
            )
        };
        findings.push(finding(
            "CPU & MEMORY",
            if !cpu.is_empty() && memory_total > 0 { "GOOD" } else { "NOT SUPPORTED" },
            format!("CPU: {} ({}) · Memory in use: {:.1} / {:.1} GB", if cpu.is_empty() { "not reported" } else { &cpu }, cpu_usage, memory_used as f64 / 1_073_741_824.0, memory_total as f64 / 1_073_741_824.0),
            "Values are read from Windows; CSRIFT does not estimate missing sensor data.",
        ));
        findings.push(finding(
            "CS2 PROCESS",
            "GOOD",
            if system.processes().values().any(|process| process.name().to_string_lossy().eq_ignore_ascii_case("cs2.exe")) {
                "The CS2 process is currently running (process presence only).".to_string()
            } else {
                "CS2 is not currently running. No game-process data was accessed.".to_string()
            },
            "CSRIFT does not inspect game memory or interact with the running game.",
        ));
        let components = Components::new_with_refreshed_list();
        let gpu_temperature = components.iter().any(|component| {
            let label = component.label().to_ascii_lowercase();
            (label.contains("gpu") || label.contains("graphics")) && component.temperature().is_some()
        });
        let gpu_names = gpu_device_names();
        findings.push(finding(
            "GPU DEVICE",
            if gpu_names.is_empty() { "NOT SUPPORTED" } else { "GOOD" },
            if gpu_names.is_empty() {
                "Windows did not expose a graphics adapter name through its display-driver registry.".to_string()
            } else {
                format!("{} · telemetry: {}", gpu_names.join(", "), if gpu_temperature { "graphics temperature sensor available" } else { "usage / temperature sensors unavailable" })
            },
            "Use the GPU vendor's trusted monitoring software for telemetry not exposed to CSRIFT.",
        ));
        let disks = Disks::new_with_refreshed_list();
        let disk_summary = disks
            .iter()
            .map(|disk| {
                let total = disk.total_space();
                let available = disk.available_space();
                format!(
                    "{}: {:.1} GB free / {:.1} GB",
                    disk.mount_point().display(),
                    available as f64 / 1_073_741_824.0,
                    total as f64 / 1_073_741_824.0
                )
            })
            .collect::<Vec<_>>();
        findings.push(finding(
            "DISK CAPACITY",
            if disk_summary.is_empty() { "NOT SUPPORTED" } else { "GOOD" },
            if disk_summary.is_empty() { "Windows did not report mounted disk capacity.".to_string() } else { disk_summary.join(" · ") },
            "Capacity is informational; CSRIFT does not delete files during a scan.",
        ));

        scan_cancelled(&cancelled)?;
        emit_scan_progress(&app, "CHECKING NETWORK STATUS", 61)?;
        let networks = Networks::new_with_refreshed_list();
        let route_v4 = active_network_route(true);
        let route_v6 = active_network_route(false);
        findings.push(finding(
            "NETWORK ADAPTERS",
            if networks.is_empty() { "NOT SUPPORTED" } else { "GOOD" },
            if networks.is_empty() { "Windows did not report network interfaces.".to_string() } else { format!("{} interface(s): {}", networks.len(), networks.keys().cloned().collect::<Vec<_>>().join(", ")) },
            "Adapter presence alone does not guarantee a route to the internet or a CS2 server.",
        ));
        findings.push(finding(
            "IPV4 ROUTE",
            if route_v4.is_some() { "GOOD" } else { "NEEDS ATTENTION" },
            route_v4.clone().map(|address| format!("Windows selected local IPv4 address {address} for an internet route."))
                .unwrap_or_else(|| "No active IPv4 route to the diagnostic target was found.".to_string()),
            "The following ping samples use Cloudflare DNS as a public comparison endpoint, not a CS2 server.",
        ));
        findings.push(finding(
            "IPV6 ROUTE",
            if route_v6.is_some() { "GOOD" } else { "NOT SUPPORTED" },
            route_v6.clone().map(|address| format!("Windows selected local IPv6 address {address} for an internet route."))
                .unwrap_or_else(|| "No IPv6 route to the diagnostic target was detected; IPv4 remains tested separately.".to_string()),
            "IPv6 availability depends on your network provider and local configuration.",
        ));
        if route_v4.is_some() {
            let mut received = 0u32;
            let mut latencies = Vec::new();
            let mut samples = Vec::new();
            for index in 0..4 {
                scan_cancelled(&cancelled)?;
                let (replied, latency, display) = ping_once("1.1.1.1", true)?;
                received += u32::from(replied);
                if let Some(latency) = latency {
                    latencies.push(latency);
                }
                samples.push(display);
                emit_scan_progress(&app, "CHECKING NETWORK STATUS", 63 + (index as u8 * 4))?;
                if index < 3 {
                    wait_for_scan_interval(&cancelled, Duration::from_millis(800))?;
                }
            }
            let average = if latencies.is_empty() {
                "not measurable (<1 ms replies or no numeric samples)".to_string()
            } else {
                format!("{:.1} ms average", latencies.iter().sum::<f64>() / latencies.len() as f64)
            };
            let loss = (4 - received) as f32 * 25.0;
            findings.push(finding(
                "IPV4 PING · 1.1.1.1",
                if received == 4 { "GOOD" } else { "NEEDS ATTENTION" },
                format!("4 packets sent · {received} received · {loss:.0}% loss · {average} · samples: {}", samples.join(", ")),
                "This is a live public-resolver sample, not a measurement of your CS2 match server or a promise of lower game latency.",
            ));
        } else {
            findings.push(finding(
                "IPV4 PING · 1.1.1.1",
                "NOT SUPPORTED",
                "No IPv4 route was detected, so ping packets were not sent.".to_string(),
                "Check your network connection; a game-server route may differ.",
            ));
        }
        if route_v6.is_some() {
            let mut received = 0u32;
            let mut latencies = Vec::new();
            let mut samples = Vec::new();
            for index in 0..4 {
                scan_cancelled(&cancelled)?;
                let (replied, latency, display) = ping_once("2606:4700:4700::1111", false)?;
                received += u32::from(replied);
                if let Some(latency) = latency {
                    latencies.push(latency);
                }
                samples.push(display);
                emit_scan_progress(&app, "CHECKING NETWORK STATUS", 81 + (index as u8 * 3))?;
                if index < 3 {
                    wait_for_scan_interval(&cancelled, Duration::from_millis(800))?;
                }
            }
            let average = if latencies.is_empty() {
                "not measurable (<1 ms replies or no numeric samples)".to_string()
            } else {
                format!("{:.1} ms average", latencies.iter().sum::<f64>() / latencies.len() as f64)
            };
            let loss = (4 - received) as f32 * 25.0;
            findings.push(finding(
                "IPV6 PING · CLOUDFLARE",
                if received == 4 { "GOOD" } else { "NEEDS ATTENTION" },
                format!("4 packets sent · {received} received · {loss:.0}% loss · {average} · samples: {}", samples.join(", ")),
                "This public endpoint is only a comparison sample; it does not represent your CS2 match server.",
            ));
        } else {
            findings.push(finding(
                "IPV6 PING · CLOUDFLARE",
                "NOT SUPPORTED",
                "No IPv6 route was detected, so IPv6 ping packets were not sent.".to_string(),
                "IPv6 support depends on your network; this does not prevent the separate IPv4 test.",
            ));
        }
        match list_dns_servers() {
            Ok(servers) if !servers.is_empty() => findings.push(finding(
                "DNS SERVERS",
                "GOOD",
                format!("{} configured server(s): {}", servers.len(), servers.iter().map(|server| server.address.as_str()).collect::<Vec<_>>().join(", ")),
                "DNS selection does not guarantee lower CS2 ping; CSRIFT does not change resolver settings.",
            )),
            Ok(_) => findings.push(finding(
                "DNS SERVERS",
                "NEEDS ATTENTION",
                "Windows reported no configured DNS server addresses.".to_string(),
                "Review DNS configuration in Windows Settings or with your network administrator.",
            )),
            Err(error) => findings.push(finding(
                "DNS SERVERS",
                "NOT SUPPORTED",
                format!("DNS settings could not be read: {error}"),
                "CSRIFT leaves DNS settings unchanged.",
            )),
        }
        #[cfg(target_os = "windows")]
        let game_mode = read_game_mode_value();
        #[cfg(not(target_os = "windows"))]
        let game_mode: Result<Option<u32>, String> =
            Err("Windows Game Mode is supported only on Windows.".to_string());
        match game_mode {
            Ok(Some(1)) => findings.push(finding(
                "WINDOWS GAME MODE",
                "GOOD",
                "Windows reports Game Mode enabled.".to_string(),
                "CSRIFT can restore a prior value if it changes this setting after your confirmation.",
            )),
            Ok(Some(_)) => findings.push(finding(
                "WINDOWS GAME MODE",
                "NEEDS ATTENTION",
                "Windows reports Game Mode disabled.".to_string(),
                "CSRIFT can enable this current-user setting after your confirmation and save its previous value for restore.",
            )),
            Ok(None) => findings.push(finding(
                "WINDOWS GAME MODE",
                "NOT SUPPORTED",
                "Windows did not report an explicit Game Mode value for the current user.".to_string(),
                "CSRIFT can create the current-user setting after your confirmation and remove its value if you restore.",
            )),
            Err(error) => findings.push(finding(
                "WINDOWS GAME MODE",
                "NOT SUPPORTED",
                format!("Game Mode could not be read: {error}"),
                "CSRIFT leaves the setting unchanged when Windows does not allow it to be read.",
            )),
        }
        match get_active_power_plan() {
            Ok(plan) => findings.push(finding(
                "WINDOWS POWER PLAN",
                if plan.available { "GOOD" } else { "NOT SUPPORTED" },
                format!("{} · {}", plan.name.unwrap_or_else(|| "Plan name unavailable".to_string()), plan.guid.unwrap_or_else(|| "GUID unavailable".to_string())),
                "A High performance plan is optional, may use more power, and is never enabled without your confirmation.",
            )),
            Err(error) => findings.push(finding(
                "WINDOWS POWER PLAN",
                "NOT SUPPORTED",
                format!("The active power plan could not be read: {error}"),
                "CSRIFT leaves power settings unchanged when Windows cannot report them.",
            )),
        }

        scan_cancelled(&cancelled)?;
        emit_scan_progress(&app, "FINALIZING SCAN", 96)?;
        wait_for_scan_interval(
            &cancelled,
            Duration::from_secs(5).saturating_sub(scan_started.elapsed()),
        )?;
        let good_count = findings.iter().filter(|item| item.status == "GOOD").count();
        let attention_count = findings.iter().filter(|item| item.status == "NEEDS ATTENTION").count();
        let unsupported_count = findings.iter().filter(|item| item.status == "NOT SUPPORTED").count();
        emit_scan_progress(&app, "FINALIZING SCAN", 100)?;
        Ok(ScanReport { completed_at_ms: unix_millis(), duration_ms: scan_started.elapsed().as_millis(), findings, good_count, attention_count, unsupported_count })
    })
    .await
    .map_err(|error| format!("Hawk Eye scan failed: {error}"))?
}

#[tauri::command]
fn cancel_hawk_eye_scan(cancellation: State<'_, ScanCancellation>) {
    cancellation.0.store(true, Ordering::Relaxed);
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
    for entry in
        fs::read_dir(root).map_err(|error| format!("Could not read local backups: {error}"))?
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
        return Err(
            "The detected CS2 folder has no supported .cfg or .vcfg files to back up.".to_string(),
        );
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
    if backup_id.is_empty()
        || !backup_id
            .chars()
            .all(|character| character.is_ascii_digit())
    {
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
            return Err(
                "A backup contains an unsupported file name; restore was cancelled.".to_string(),
            );
        }
        let source = stored.join(name);
        if !source.is_file() {
            return Err(format!("A backed-up file is missing: {name}"));
        }
    }

    let safety = create_config_backup(app.clone())?;
    for name in &backup.files {
        fs::copy(stored.join(name), live_config.join(name)).map_err(|error| {
            format!(
                "Could not restore {name}; safety backup {} was created: {error}",
                safety.id
            )
        })?;
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
    serde_json::from_str(&content).map_err(|error| format!("CSRIFT settings are invalid: {error}"))
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
        || !name.chars().all(|character| {
            character.is_alphanumeric() || character == ' ' || character == '-' || character == '_'
        })
    {
        return Err(
            "Use a profile name with up to 32 letters, numbers, spaces, hyphens, or underscores."
                .to_string(),
        );
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
    fs::write(
        profiles_dir(&app)?.join(format!("{}.json", profile.id)),
        content,
    )
    .map_err(|error| format!("Could not save the profile: {error}"))?;
    Ok(profile)
}

#[tauri::command]
fn rename_config_profile(
    app: AppHandle,
    profile_id: String,
    name: String,
) -> Result<ConfigProfile, String> {
    if profile_id.is_empty()
        || !profile_id
            .chars()
            .all(|character| character.is_ascii_digit())
    {
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
    if profile_id.is_empty()
        || !profile_id
            .chars()
            .all(|character| character.is_ascii_digit())
    {
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
        .manage(ScanCancellation::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_system_snapshot,
            detect_cs2_installation,
            launch_cs2_game,
            detect_installed_steam_games,
            list_installed_steam_games,
            detect_managed_game_installations,
            pick_managed_game_executable,
            launch_managed_game,
            pick_cs2_installation_directory,
            run_hawk_eye_scan,
            cancel_hawk_eye_scan,
            run_ping_test,
            list_startup_entries,
            list_dns_servers,
            get_active_power_plan,
            get_cs2_optimization_status,
            apply_cs2_optimization,
            restore_cs2_optimization,
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

#[cfg(test)]
mod tests {
    use super::{
        average_jitter_ms, game_executable_name_matches, has_cs2_launch_options,
        parse_app_manifest_install_dir, parse_ping_output, parse_steam_library_paths,
        safe_steam_install_directory, vdf_values, CS2_STEAM_APP_ID,
    };

    #[test]
    fn cs2_launch_uses_the_steam_app_id() {
        assert_eq!(CS2_STEAM_APP_ID, "730");
    }

    #[test]
    fn parses_ping_reply_and_sub_millisecond_samples() {
        let output = "Reply from 1.1.1.1: bytes=32 time=24ms TTL=57\nReply from 1.1.1.1: bytes=32 time<1ms TTL=57";
        let (replies, displayed, measured) = parse_ping_output(output);
        assert_eq!(replies, 2);
        assert_eq!(displayed, vec!["24 ms", "<1 ms"]);
        assert_eq!(measured, vec![24.0, 0.5]);
        assert_eq!(average_jitter_ms(&measured), Some(23.5));
    }

    #[test]
    fn computes_jitter_only_from_multiple_measured_replies() {
        assert_eq!(average_jitter_ms(&[12.0, 16.0, 14.0]), Some(3.0));
        assert_eq!(average_jitter_ms(&[12.0]), None);
        assert_eq!(average_jitter_ms(&[]), None);
    }

    #[test]
    fn recognizes_supported_non_steam_game_executables() {
        assert!(game_executable_name_matches("fc-online", "FIFAOnline4.exe"));
        assert!(game_executable_name_matches("fc-online", "fifa4zf.exe"));
        assert!(game_executable_name_matches(
            "valorant",
            "VALORANT-Win64-Shipping.exe"
        ));
        assert!(!game_executable_name_matches("fc-online", "TslGame.exe"));
        assert!(!game_executable_name_matches("unknown", "game.exe"));
    }

    #[test]
    fn ignores_ping_timeouts_when_counting_replies() {
        let output = "Request timed out.\nRequest timed out.";
        let (replies, displayed, measured) = parse_ping_output(output);
        assert_eq!(replies, 0);
        assert!(displayed.is_empty());
        assert!(measured.is_empty());
    }

    #[test]
    fn reads_escaped_steam_library_paths() {
        let contents = "\"libraryfolders\"\n{\n  \"0\"\n  {\n    \"path\" \"C:\\\\Program Files (x86)\\\\Steam\"\n  }\n  \"1\" \"D:\\\\SteamLibrary\"\n}";
        let paths = parse_steam_library_paths(contents);
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0].to_string_lossy(), r"C:\Program Files (x86)\Steam");
        assert_eq!(paths[1].to_string_lossy(), r"D:\SteamLibrary");
    }

    #[test]
    fn parses_quoted_vdf_values_with_escaped_backslashes() {
        assert_eq!(
            vdf_values("\"path\" \"E:\\\\Games\\\\Steam\""),
            vec!["path", r"E:\Games\Steam"]
        );
    }

    #[test]
    fn only_reports_steam_manifests_marked_installed_for_the_requested_app() {
        let installed = "\"AppState\"\n{\n  \"appid\" \"730\"\n  \"StateFlags\" \"4\"\n  \"installdir\" \"Counter-Strike Global Offensive\"\n}";
        let updating = "\"AppState\"\n{\n  \"appid\" \"730\"\n  \"StateFlags\" \"2\"\n  \"installdir\" \"Counter-Strike Global Offensive\"\n}";
        assert_eq!(
            parse_app_manifest_install_dir(installed, 730).as_deref(),
            Some("Counter-Strike Global Offensive")
        );
        assert_eq!(parse_app_manifest_install_dir(installed, 440), None);
        assert_eq!(parse_app_manifest_install_dir(updating, 730), None);
    }

    #[test]
    fn rejects_steam_install_directories_that_escape_the_library() {
        assert!(safe_steam_install_directory("Counter-Strike 2"));
        assert!(!safe_steam_install_directory("..\\outside"));
        assert!(!safe_steam_install_directory("D:\\outside"));
    }

    #[test]
    fn only_reads_launch_options_from_the_cs2_app_section() {
        let cs2_options = "\"apps\"\n{\n  \"730\"\n  {\n    \"LaunchOptions\" \"-novid\"\n  }\n  \"440\"\n  {\n    \"LaunchOptions\" \"-dxlevel 90\"\n  }\n}";
        let other_game_options = "\"apps\"\n{\n  \"730\"\n  {\n    \"LaunchOptions\" \"\"\n  }\n  \"440\"\n  {\n    \"LaunchOptions\" \"-dxlevel 90\"\n  }\n}";
        assert!(has_cs2_launch_options(cs2_options));
        assert!(!has_cs2_launch_options(other_game_options));
    }
}
