# AGENTS.md — ch32-rs-CubeMX 项目约定

> 修改代码前先读 `docs/PROJECT_MEMORY.md` 与 `docs/HAL_API_NOTES.md`。

## 项目定位

纯本地 Web 应用（无后端/无云），对标 STM32CubeMX2 的 GUI，代码生成后端是 **Rust + ch32-hal**（WCH CH32 RISC-V）。
一键导出可直接 `cargo build` 的工程。

## 硬性约束

1. 技术栈：Vite + Vue 3 + TypeScript + Pinia + Element Plus + 原生 SVG + EJS（client:true）+ JSZip + Vitest + Monaco。不引入 Tailwind/其它 UI 框架。
2. **数据驱动**：新增芯片只改 `data/devices/<chip>/` JSON + 跑校验。禁止在组件/lib 里写 `if (chip === '...')` 分支。
3. **禁止臆造 ch32-hal API**：写生成器前核对 `reference/ch32-hal/src/`，记入 `docs/HAL_API_NOTES.md`（含 rev）。
4. 不生成 C 代码；不照搬参考实现（GD32/ARM）的模板结构。
5. 生成区 `src/generated/**` 每次导出整体重写；`src/main.rs` 永不覆盖。
6. 界面与提交信息中文；代码注释中文，标识符英文。
7. 覆盖已有引脚配置一律走 `usePinOverwrite`（确认 + 撤回）。

## 命令

- `npm run dev` / `build`（vue-tsc + vite）/ `test` / `lint` / `validate:device` / `verify:build`
- `npm run import:ch32data` —— 从 ch32-data 重新生成 remap/interrupts/dma/芯片索引
- 回归门禁：test / build / lint / validate:device 全绿 + verify:build 端到端编译通过

## 真相源（只读参考，勿改）

- `reference/ch32-hal`（rev a0863ebc…）—— HAL API
- `reference/ch32-hal-template` —— 工程骨架
- `reference/ch32-data` —— 芯片/中断/DMA/引脚信号
- `reference/MCUCubeMX` —— 架构参考（GD32/C，只借架构不借代码）
- `reference/mx2-ui/*.png` —— GUI 基准

## 已知坑

- rv32ec 是 tier-3：nightly + rust-src + `-Z build-std=core` + 自定义 target json。
- V003 仅 2KB SRAM：默认不开 embassy；开了给 RAM 预算警告。
- ch32-hal 未发 crates.io：git 依赖锁 rev（`src/lib/codegen/halRev.ts`）。
- REMAP 是 const 泛型：同外设引脚 remap 不一致编译必失败 → REMAP_MISMATCH 配置期拦截。
- EXTI 边沿不在构造函数；ADC 通道是引脚 trait 实现。
- EJS 空行：if/forEach 结束标签用 `-%>`。
- verify:build 用 vite-node 复用浏览器同一份生成逻辑，禁止复制两份。