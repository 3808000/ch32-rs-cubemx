# ch32-rs-CubeMX v0.01

首个可运行版本：纯本地的 CH32 图形化配置器，界面风格对标 STM32CubeMX2，代码生成后端为 **Rust + ch32-hal**（不生成 C 代码）。

## 功能

- **引脚配置**：封装图（dual/quad）+ 45° 倾斜动效、引脚搜索/类型过滤、冲突检查、分组、批量分配、表格视图
- **时钟树**：数据驱动画布、PLL 解算、频率链校验、预设应用、3× 缩放、时钟问题定位
- **外设**：USART / SPI / I2C / ADC / EXTI 实例配置、remap 切换、参数编辑、使用汇总
- **代码导出**：EJS 模板生成 Rust 工程，Monaco 只读预览 + diff；导出 ZIP / 直接写入文件夹 / 仅导出 cube.json
- **内嵌完整 HAL**：导出工程默认携带完整 `vendor/ch32-hal` 源码（path 依赖，可跳转阅读）
- **工程回读**：`cube.json` 可随时导入继续配置（等价于 CubeMX 的 `.ioc`）
- **桌面应用**：Tauri 2 原生窗口；ZIP/配置/目录导出走原生保存对话框

## 支持芯片

| 芯片 | 封装 | 内核 | 导出编译验证 |
|---|---|---|---|
| CH32V003F4P6 | TSSOP20 | QingKe V2A · RV32EC | ✅ `cargo build`（nightly） |
| CH32V203C8T6 | LQFP48 | QingKe V4B · RV32IMAC | ✅ `cargo build` |
| CH32H417QEU6 | QFN128 | QingKe V3F + V5F 双核 | ✅ `cargo xtask build`（workspace） |
| CH582M | QFN48 | QingKe V4A | ⏳ 数据可查，ch58x-hal 后端尚未实现（导出有守卫） |

## 安装（Linux x86_64）

```bash
tar -xzf ch32-rs-cubemx-v0.01-linux-x86_64.tar.gz
./ch32-rs-cubemx
```

需要系统 WebKitGTK 4.1 与 GTK3 运行库（Fedora / Ubuntu / Arch 等主流发行版默认自带）。
也可以使用 `.rpm` / `.deb`（若本次构建产出）通过包管理器安装。

## 从源码运行

```bash
npm install
npm run dev            # 浏览器模式
npm run desktop:dev    # 桌面模式（需要 Rust + WebKitGTK 开发包）
```

## 质量门禁

- 单元测试：**380 用例全绿**
- `vue-tsc` / ESLint / `vite build` 全绿
- 器件数据校验：4 颗芯片 0 错误 0 警告
- 端到端编译：V003 / V203 / H417 三颗芯片生成的工程均通过 cargo 构建

## 已知限制

- CH582M 仅支持数据查看，暂不能导出工程（ch58x-hal 后端待接入）
- Windows / macOS 产物需在对应平台从源码构建
- 浏览器模式下“导出到文件夹”依赖 Chromium 的 File System Access API；Firefox/Safari 请用 ZIP 导出