// 桌面壳入口：窗口与全部配置见图 tauri.conf.json。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ch32_rs_cubemx_lib::run()
}