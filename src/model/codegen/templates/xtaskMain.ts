// 双核 xtask/src/main.rs（构建/烧录/镜像合并驱动）
export const XTASK_MAIN_TPL = `//! 双核工程构建 / 烧录 / 合并驱动（由 ch32-rs-CubeMX 生成）。
//!
//!
//! cargo xtask build                 构建两个核
//! cargo xtask flash [--no-build]    先烧 V3F（halt），最后烧 V5F 并复位运行
//! cargo xtask merge [--out DIR]     合并两个镜像为 .bin/.hex
//!
//!
//! reset 只启动 V3F；V5F 由 V3F 镜像调用 qingke::pfic::wake_other_core() 唤醒。

use std::path::{Path, PathBuf};
use std::process::{exit, Command};
use std::{env, fs};

/// 擦除态字节，用于填充合并镜像
const ERASED: u8 = 0xFF;

struct Core {
    /// crate 目录名（同时也是 Cargo 包名后缀）
    name: &'static str,
    target: &'static str,
    /// bin 目标名（= Cargo 包名）
    bin: &'static str,
    flash_base: u64,
    flash_limit: u64,
}

const CORES: [Core; <%- cores.length %>] = [
<% cores.forEach(function(c){ -%>
    Core {
        name: "<%- c.id %>",
        target: "<%- c.target %>",
        bin: "<%- c.bin %>",
        flash_base: <%- c.flashBase %>,
        flash_limit: <%- c.flashLimit %>,
    },
<% }) -%>
];

const USAGE: &str = "\\
usage: cargo xtask <command> [options]

commands:
  build                       构建两个核（release）
  flash [--no-build]          构建后依次烧录 V3F、V5F
  merge [--out DIR]           合并镜像到 out/<bin>.bin 与 .hex

WLINK_PROBE=VID:PID:SERIAL（或 wlink 索引）可固定探针。
";

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some((command, rest)) = args.split_first() else {
        fail(USAGE);
    };

    let opts = Options::parse(rest);
    match command.as_str() {
        "build" => build(&opts),
        "flash" => flash(&opts),
        "merge" => merge(&opts),
        "help" | "--help" | "-h" => println!("{USAGE}"),
        other => fail(&format!("unknown command '{other}'\\n\\n{USAGE}")),
    }
}

struct Options {
    no_build: bool,
    out: Option<PathBuf>,
}

impl Options {
    fn parse(args: &[String]) -> Options {
        let mut opts = Options { no_build: false, out: None };
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--out" => opts.out = args.next().map(PathBuf::from),
                "--no-build" => opts.no_build = true,
                other => fail(&format!("unknown option '{other}'\\n\\n{USAGE}")),
            }
        }
        opts
    }
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask 位于工程根下一层")
        .to_path_buf()
}

fn elf_path(core: &Core) -> PathBuf {
    // workspace 成员共用根 target/ 目录
    root()
        .join("target")
        .join(core.target)
        .join("release")
        .join(core.bin)
}

fn wlink_selector_args() -> Vec<String> {
    match env::var("WLINK_PROBE").or_else(|_| env::var("PROBE_RS_PROBE")) {
        Ok(selector) if !selector.is_empty() => vec!["-d".to_string(), selector],
        _ => Vec::new(),
    }
}

fn run(program: &str, args: &[&str], dir: &Path) {
    println!("  {} {}", program, args.join(" "));
    let status = Command::new(program)
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap_or_else(|e| fail(&format!("无法运行 '{program}'：{e}")));
    if !status.success() {
        fail(&format!("'{program}' 失败：{status}"));
    }
}

fn run_wlink(args: &[&str], dir: &Path) {
    let selector = wlink_selector_args();
    let mut all: Vec<&str> = selector.iter().map(String::as_str).collect();
    all.extend_from_slice(args);
    run("wlink", &all, dir);
}

fn build(_opts: &Options) {
    for core in &CORES {
        let dir = root().join(core.name);
        println!("构建 {}（{}）...", core.name, core.bin);
        run("cargo", &["build", "--release", "--bin", core.bin], &dir);
    }
    println!("构建完成：{} 个核", CORES.len());
}

fn flash(opts: &Options) {
    if !opts.no_build {
        build(opts);
    }
    // 先烧 V3F（--no-run 保持芯片 halt），最后烧 V5F 时复位运行；此时两个镜像都已就位。
    for (i, core) in CORES.iter().enumerate() {
        let elf = elf_path(core);
        let path = elf.to_str().expect("utf-8 path");
        println!("烧录 {}（{}）...", core.name, core.bin);
        if i + 1 == CORES.len() {
            run_wlink(&["flash", path], &root());
        } else {
            run_wlink(&["flash", "--no-run", path], &root());
        }
    }
}

struct Segment {
    core: &'static str,
    base: u64,
    bytes: Vec<u8>,
}

fn merge(opts: &Options) {
    let segments: Vec<Segment> = CORES
        .iter()
        .map(|core| Segment {
            core: core.name,
            base: core.flash_base,
            bytes: flatten(&elf_path(core), core),
        })
        .collect();

    let end = segments
        .iter()
        .map(|s| s.base + s.bytes.len() as u64)
        .max()
        .expect("至少一个段");
    let mut image = vec![ERASED; end as usize];
    for segment in &segments {
        let at = segment.base as usize;
        image[at..at + segment.bytes.len()].copy_from_slice(&segment.bytes);
    }

    let out_dir = opts.out.clone().unwrap_or_else(|| root().join("out"));
    fs::create_dir_all(&out_dir)
        .unwrap_or_else(|e| fail(&format!("无法创建 {}：{e}", out_dir.display())));
    let bin = out_dir.join("firmware.bin");
    let hex = out_dir.join("firmware.hex");
    fs::write(&bin, &image)
        .unwrap_or_else(|e| fail(&format!("无法写入 {}：{e}", bin.display())));
    fs::write(&hex, intel_hex(&segments))
        .unwrap_or_else(|e| fail(&format!("无法写入 {}：{e}", hex.display())));

    for segment in &segments {
        println!(
            "  {:<4} {:#010x}  {:>7} bytes",
            segment.core,
            segment.base,
            segment.bytes.len()
        );
    }
    println!("合并镜像：{}（{} bytes）", bin.display(), image.len());
    println!("Intel HEX：{}", hex.display());
}

fn flatten(elf: &Path, core: &Core) -> Vec<u8> {
    if !elf.exists() {
        fail(&format!("{} 未构建，先运行 'cargo xtask build'", elf.display()));
    }
    let tmp = env::temp_dir().join(format!("h417-{}-{}.bin", core.name, std::process::id()));
    let objcopy = objcopy();
    run(
        &objcopy,
        &[
            "-O",
            "binary",
            "--gap-fill",
            "0xFF",
            elf.to_str().unwrap(),
            tmp.to_str().unwrap(),
        ],
        &root(),
    );
    let bytes =
        fs::read(&tmp).unwrap_or_else(|e| fail(&format!("无法读取 {}：{e}", tmp.display())));
    let _ = fs::remove_file(&tmp);

    if bytes.len() as u64 > core.flash_limit {
        fail(&format!(
            "{}：{} bytes 超过其 {} bytes flash 区，会与另一个镜像重叠",
            core.name,
            bytes.len(),
            core.flash_limit
        ));
    }
    bytes
}

fn objcopy() -> String {
    tool("llvm-objcopy")
}

fn tool(name: &str) -> String {
    let output = |args: &[&str]| {
        Command::new("rustc")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    if let (Some(sysroot), Some(host)) = (output(&["--print", "sysroot"]), output(&["-vV"])) {
        let host = host
            .lines()
            .find_map(|line| line.strip_prefix("host: ").map(str::to_string));
        if let Some(host) = host {
            let path = Path::new(&sysroot)
                .join("lib/rustlib")
                .join(host)
                .join("bin")
                .join(name);
            if path.exists() {
                return path.to_string_lossy().into_owned();
            }
        }
    }
    name.to_string()
}

fn intel_hex(segments: &[Segment]) -> String {
    let mut hex = String::new();
    let mut upper = u32::MAX;
    for segment in segments {
        for (i, chunk) in segment.bytes.chunks(16).enumerate() {
            let address = segment.base as u32 + (i * 16) as u32;
            if address >> 16 != upper {
                upper = address >> 16;
                hex.push_str(&record(0x04, 0, &[(upper >> 8) as u8, upper as u8]));
            }
            hex.push_str(&record(0x00, (address & 0xFFFF) as u16, chunk));
        }
    }
    hex.push_str(":00000001FF\\n");
    hex
}

fn record(record_type: u8, address: u16, data: &[u8]) -> String {
    let mut bytes = vec![data.len() as u8, (address >> 8) as u8, address as u8, record_type];
    bytes.extend_from_slice(data);
    let sum = bytes.iter().fold(0u8, |acc, b| acc.wrapping_add(*b));
    let checksum = (!sum).wrapping_add(1);

    let mut line = format!(":{bytes:02X?}");
    line.retain(|c| !matches!(c, '[' | ']' | ' ' | ','));
    format!("{line}{checksum:02X}\\n")
}

fn fail(message: &str) -> ! {
    eprintln!("xtask: {message}");
    exit(1);
}
`
