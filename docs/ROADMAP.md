# ch32-rs-CubeMX 功能完善路线图（对标 STM32CubeMX2）

> 依据：[ANALYSIS-MX2-GAP.md](ANALYSIS-MX2-GAP.md)（视图与交互，CDP 实机分析） + [ANALYSIS-MX2-CODEGEN-GAP.md](ANALYSIS-MX2-CODEGEN-GAP.md)（生成器与工程生态，.ioc2/bundle 一手分析）。
> 制定日期：2026-11-16。基线：v0.01（380 测试 / 三芯片端到端编译 / MVC 分层完成）。
>
> 里程碑编号即版本号目标。每个任务给出：改动落点（遵循 model/services/controllers/views 分层）、验收标准、可并行性（适合派子智能体的边界）。

---

## 0. 总原则

1. **保持「生成物永远可编译」**：每个里程碑合入前 `npm run test && npm run verify:build`（V003/V203/H417）必须全绿——这是对 CubeMX 的核心差异化优势，任何 UI 进度不得牺牲它。
2. **数据先行**：所有新能力先扩 `data/devices/<chip>/*.json` + `cube.json` schema（向后兼容的可选字段），再写 UI 与生成器。
3. **不改 version 就能升级**：新增 cube.json 字段一律可选，`parseProjectFile` 保留未知字段。
4. **子代理并行边界**：按「文件域」划分（model / services / views+components / 数据 JSON），互不触碰对方文件；每个代理交付前跑 `vue-tsc + vitest + eslint(自己的域)`。

---

## M1（v0.02）再生成安全网 —— 「重新导出不丢用户工作」 ✅ 已完成（2026-11-16）

> 来源：CODEGEN-GAP P0-1/2/3 + GAP 报告发现的文档链接 bug。这是唯一会**静默破坏用户工程**的一组，最优先。
>
> **落地状态**：7 项全部完成并推送（commits e7676d0…f799832）。425 测试全绿、verify:build 3/3、validate 0 错、浏览器验收通过（导出对话框/ZIP 含 manifest/文档链接随芯片切换）。子代理 A/B/C 分域并行，C 的对话框接线由主控亲自收尾。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 1.1 | **文件组模型**：`FileGroup = 'generated' \| 'project_file' \| 'user_code' \| 'pack'`；`GeneratedFile.group`；分组规则（`src/generated/**`=generated；`src/main.rs`=user_code；`Cargo.toml`/`.cargo`/`rust-toolchain.toml`/`build.rs`/`.gitignore`/`README.md`/`cube.json`=project_file；`vendor/**`=pack） | `model/types/codegen.ts`、`model/codegen/{index,core,cargo,readme,workspace}.ts` | 单测：每个生成物携带正确 group；快照更新 | model/codegen |
| 1.2 | **导出清单 manifest**：`.ch32cube/export-manifest.json`（generator 版本/timestamp/configHash/files[{path,group,sha256}]），ZIP 与目录导出都写入 | 新增 `model/codegen/manifest.ts`；`services/projectExport.ts` | 单测：manifest 内容与文件集一致；configHash 稳定（canonical JSON） | model/codegen（独立文件） |
| 1.3 | **目录导出 plan 化**：写盘前产出 `plan[]`（unchanged/create/update/delete/conflict，基于 manifest+磁盘哈希）；`generated` 组内容相同跳过写入；上次有本次无→delete（仅 generated 组）；用户手改过的 generated 文件→默认 skip-conflict 并警告 | `services/projectExport.ts`（桌面端需 Rust `read_folder` 命令扩展 `src-tauri/src/lib.rs`） | 单测：五种 action；集成：导出→改 pins.rs→再导出 弹复核且默认不覆盖 | services + src-tauri |
| 1.4 | **冲突解决 UI**：导出对话框升级——预览「将新建 X / 更新 Y / 删除 Z / 保留 W」；conflict 文件可逐个选 skip/overwrite/backup/写 `_base`；类别级默认策略表（对齐 CubeMX2 Automatic Conflict Handling Rules） | `components/CodegenDialog.vue` 拆分为 `components/codegen/{ExportPlanPreview,ConflictRules}.vue`；store 加 `exportPlan` | 浏览器验收：冲突场景截图 + 选择生效 | components/codegen |
| 1.5 | **`unlockedPins` 入快照**：`ProjectConfig.unlockedPins?: string[]`；config getter 输出、loadConfig 读入、parse 校验 | `model/types/project.ts`、`controllers/project.ts`、`services/projectFile.ts` | 单测：解锁→导出→导入 往返一致 | model+controllers（小，可并入 1.1 域） |
| 1.6 | **project_file「生成一次」+ Cargo.toml 标记区合并**：已存在的 project_file 默认不动；`Cargo.toml` 用 `# >>> ch32-cubemx generated >>>` 区间只重写标记区，保留用户依赖/profile；vendor 已存在默认跳过（`--refresh-vendor` 强制） | `model/codegen/cargo.ts` + 新 `services/tomlMerge.ts` | 单测：加依赖→重导出→依赖仍在且 profile 区更新 | model/codegen |
| 1.7 | **文档链接按芯片**（修 bug：换芯片后仍显示 V003 链接）：`chip.json` 加 `docUrl`；页头/About 统一读取 | `data/devices/*/chip.json`、`views/PinoutView.vue`、`views/PeripheralsView.vue` | 4 芯片切换验证链接正确 | data JSON（独立） |

**M1 验收门禁**：380+ 测试全绿；新增 ≥15 测试；`verify:build` 三芯片仍过（生成物不变或显式更新）；手工脚本「导出→手改→再导出」用户改动全保留。

---

## M2（v0.03）交互主流程 —— 「找得到、配得快」 ✅ 已完成（2026-11-16）

> **落地状态**：10 项完成并推送（commits 557affc…6e3ea50）。490 测试全绿、verify:build 3/3、validate 0 错、浏览器验收通过（5 标签页/外设对象页 Mode-Activate/引脚九态过滤+右键+图例/真实菜单+最近工程+快捷键）。子代理 D/E/F 分域并行，基座与菜单契约由主控亲自实现。注：USART Sync/IrDA/SmartCard 等 HAL 未暴露 API 的模式标「待核实/禁激活」，留待 M3 生成器扩展。

> 来源：GAP 报告 P0 全部（8 项）。把「全实例卡片流 + 伪菜单」升级为 CubeMX2 的「对象标签页 + 真实菜单」。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 2.1 | **标签页模型重构**：`activeView` → `documents[]`（`{kind:'view'\|'peripheral'\|'project-settings', key, title, dirty, health}`）+ `activeDoc`；Ctrl+Tab 切换、可关闭；脏检查 | `controllers/project.ts`（新增 `documents` 状态）、重写 `components/TabStrip.vue` | 浏览器：开 USART1 页→关闭→恢复；固定四视图不受影响 | controllers+TabStrip（核心路径，单人做） |
| 2.2 | **外设单实例工作区**：左侧列表点击 → 打开实例标签页；中栏只渲染当前实例（`PeripheralWorkspaceView`）；概览/汇总独立成页 | 新 `views/PeripheralWorkspaceView.vue`；改 `views/PeripheralsView.vue` 为列表+概览 | 浏览器验收 + 交互截图 | views/components/peripherals |
| 2.3 | **Mode + Activate 流程**：数据层 `peripherals.json` 加 `modes[]`（名称+参数集+引脚需求）；UI 先选 mode 再 Activate；Deactivate 确认框不清引脚 | `data/devices/*/peripherals.json`（4 芯片）、`components/peripherals/PeripheralConfigCard.vue` | 单测：mode 驱动参数集；validate:device 过 | data JSON（大）与 UI 分两域 |
| 2.4 | **Project settings 主视图**：General（名称/路径只读展示）/ Generation（导出选项）/ Advanced（冲突规则表）三段；底部「生成工程」；`CodegenDialog` 降级为生成确认/结果 | 新 `views/ProjectSettingsView.vue`；复用 M1.4 组件 | 浏览器验收 | views |
| 2.5 | **统一引脚过滤模型**：`PinFilter{searchType: All/Pin/Signal/Label/Position, text, states[], types[]}` 作为单一真相；图形/表格共用；建议列表（匹配数+点击定位） | 新 `model/pins/pinFilter.ts`（纯函数）；改 `components/pinout/PinoutToolbar.vue`、`PinTable.vue`、`PackageCanvas.vue` 消费 | 单测：过滤矩阵；浏览器：搜索定位图表联动 | model/pins（纯函数可先行） |
| 2.6 | **Show 九态过滤 + 计数**：状态派生（configured/reserved/unassigned/notConfigurable/pinned/excluded/error/warning）；替换死控件 `showFilter` | `model/pins/pinFilter.ts` + 工具栏 | 单测 + 浏览器：各态计数正确 | 与 2.5 同域 |
| 2.7 | **引脚右键菜单**：`@contextmenu` → 分组信号清单（GPIO/Alternate/Reserved/Analog）→ Assign signal / Move signal / Configure <外设> / Edit label / Exclude pin / Reset Pin State（确认） | `PackageCanvas.vue` + 新 `components/pinout/PinContextMenu.vue` | 浏览器：PA2 右键全动作可用 | components/pinout |
| 2.8 | **引脚状态图例/徽标**：`PinState` 枚举 + 图例组件（可折叠持久化）；图形/表格/详情/悬停一致 | `model/package.ts` + 新 `components/pinout/PinLegend.vue` | 截图对比 MX2 | components/pinout |
| 2.9 | **真实菜单与最近工程**：Project 下拉（新建 MCU、打开 cube.json、最近列表、Save/Save As、关闭、偏好）；Home 最近工程卡（localStorage 索引，桌面端扫目录）；Help 补文档子菜单 | `components/AppShell.vue`（真实 popover）、`views/HomeView.vue`、新 `services/recentProjects.ts` | 浏览器：新建→配置→保存→另存→最近打开 全流程 | components 壳 + services |
| 2.10 | **快捷键体系**：Ctrl+S/Tab 切换/Ctrl+W 关标签/Esc 取消选择/`?` 上下文快捷键面板（删掉未实现的 Esc 文案 bug） | 新 `services/hotkeys.ts`（分层守卫：services 不 import controllers→改为 views 层 composable `components/common/useHotkeys.ts`） | 手测表 | components/common |

**M2 验收门禁**：全部浏览器交互验收（派 UI 验收子代理截图比对）；过滤/状态派生单测 ≥20；现有 380 测试不降。

---

## M3（v0.04）配置完备性 —— 「配得出真实工程」 ✅ 已完成（2026-11-16）

> **落地状态**：7 项完成并推送（commits 5669584…434479b）。583 测试全绿、verify:build 3/3（含中断工程实测可编译、embassy 2/2）、validate 0 错、浏览器验收通过。子代理 G/H/I 分域并行，类型/store/System 挂载基座与 HAL API 核实由主控亲自完成。注：SPI 位宽/软件 NSS、ADC 分辨率/连续转换等 HAL 无公开 API 的参数诚实标注「待核实」未臆造；H417 双核 embassy 因 chip.json 标 unsupportedFeatures 未做端到端（非 embassy workspace 已过）。

> 来源：两报告 P1 的交叉项。让 cube.json 覆盖真实工程所需的全部维度。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 3.1 | **NVIC/PFIC 中断配置**：`cube.json.interrupts[{irq, enabled, priority}]`；生成 `src/generated/irq.rs`（`qingke::pfic::set_priority`，HAL 已支持）；UI：System 分类下 NVIC 表；冲突规则（优先级/embassy 必需 IRQ） | `model/types/project.ts`、新 `model/codegen/irq.ts`、`model/conflicts/rules/`、`data/devices/*/interrupts.json` 已有 | 生成工程含 irq.rs 且 cargo build 过（verify:build 断言） | model 全链（一域做完） |
| 3.2 | **DMA 通道配置**（embassy/H417）：`cube.json.dma[{peripheral,channel,request}]`；用 dma.json 校验；修 workspace.ts 固定通道限制 | `model/types`、`model/codegen/{derive,usart,workspace}.ts`、冲突规则 | H417 双核 verify:build 过 + DMA 冲突单测 | model/codegen |
| 3.3 | **外设参数补全**：USART 校验/停止位/字长、SPI CPOL/CPHA/位宽/NSS、I2C 速率模式、ADC 采样时间/分辨率（枚举名逐字核对 HAL_API_NOTES） | `data/devices/*/peripherals.json` params spec 扩展 + `model/codegen/{usart,spi,i2c,adc}.ts` | 快照测试更新 + verify:build | data（4 芯片×并行）+ codegen |
| 3.4 | **时钟锁定 + Resolve issues 自动修复**：`clock.lockedNodes[]`（预设/解算跳过）；`Resolve clock issues` 按钮调用约束求解 auto-fix（复用 solvePll）；时钟表格可编辑 | `model/clock/{index,tree/model}.ts`、`components/clock/` | 单测：锁定不被预设覆盖；auto-fix 收敛 | model/clock（纯函数）先行 |
| 3.5 | **时钟树扩展**：外设时钟 mux 节点数据驱动补充（USART/SPI/I2C 时钟源选择） | `data/devices/*/clock.json` + `model/clock/tree/layout.ts` 多列分组 | validate:device + 树渲染验收 | data + model/clock |
| 3.6 | **外设树 9 分类**：`category` 字段补 Cortex/System/I/O/Computing/Memory/Security（空壳+计数先行） | `data/devices/*/peripherals.json` + `PeripheralList.vue` | 计数与 MX2 同构 | data JSON |
| 3.7 | **生成前 Check 报告**：`preflight()` 返回 errors/warnings 分级；弹层逐项定位（携带 `target:{view,peripheral,pin,node}` 统一 `locate()` 命令）；允许「继续生成」（warning 豁免） | 新 `model/preflight.ts` + `controllers locate()` + `components/codegen/CheckDialog.vue` | 冲突→定位→修复 闭环验收 | model + components |

---

## M4（v0.05）工程生态 —— 「像 IDE 一样管理工程」 ✅ 已完成（2026-11-16，核心 6 项）

> **落地状态**：M4.1(浏览器版)/4.2/4.3/4.4/4.5/4.6 完成并推送（commits…355d0f0）。637 测试全绿、verify:build 3/3、validate 0 错、浏览器验收通过。子代理 J/K 分域并行，双核 README/IDE 接线、档位/IDE 选项暴露、应用级自动保存由主控完成。**暂缓**：M4.7 一引脚多信号、M4.8 拖拽移动信号（复杂引脚模型改动）；M4.1 桌面磁盘工程库、launch.json 调试（wlink gdbserver 待核实）。

> 来源：两报告 P1 剩余项 + 桌面端能力。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 4.1 | **桌面工程库**：`~/.config/ch32-rs-cubemx/projects.json` + 每工程目录；自动保存（debounce 2s）+ 状态栏；工程切换恢复标签页 | Tauri 命令 + `services/projectStorage.ts` 扩展 + `controllers` | 桌面实测多工程切换 | services+src-tauri |
| 4.2 | **生成报告面板**：结果页（逐文件 action/耗时/警告）；`.ch32cube/last-generation.log`；桌面「打开所在目录」 | `components/codegen/GenerationReport.vue` + manifest 复用 | 报告内容与 plan 一致 | components/codegen |
| 4.3 | **README 报告增强**：引脚全表（按位号）/时钟五元组/外设表/中断表/Flash-RAM 预算/生成元数据（工具版本+configHash+HAL rev） | `model/codegen/readme.ts` 模板 | 快照测试 | model/codegen |
| 4.4 | **工具链档位**：`release-size/speed/debug` 三个 profile + `[alias]`；导出选项（进入 Cargo.toml 标记区） | `model/codegen/cargo.ts` + Project settings | verify:build 三 profile 构建 | model/codegen |
| 4.5 | **IDE 配置产物**（可选开关）：`.vscode/{settings,tasks,launch}.json`（rust-analyzer target、build/flash 任务、gdb/wlink 调试——先实测 wlink gdbserver 存在再写模板，不存在则 OpenOCD 模板+「实验性」标注） | 新 `model/codegen/ideConfig.ts` | 生成 VSCode 打开即用 | model/codegen |
| 4.6 | **cube.json 迁移基础设施**：`generator{name,version}`、未知字段保留、`MIGRATIONS` 链（先建通路不升版） | `services/projectFile.ts` | 未来字段向后兼容单测 | services |
| 4.7 | **信号列表弹窗**（一引脚多信号/Reserved 切换/搜索分组） | `chip.json` 允许 `signals[]` + `components/pinout/SignalsSelector.vue` | 多信号引脚验收 | data + components |
| 4.8 | **引脚拖拽移动信号** + alternate pins 高亮 | `PackageCanvas.vue` 拖拽 + `model/pins/pinFilter.assignablePins()` | 拖拽换脚无中间冲突 | model/pins + components |

---

## M5（v0.06+）体验打磨（P2 精选）

按价值排序：HTML 单文件报告（差异化卖点）→ 引脚表升级（Used only/Columns/分页/行内 Assign）→ 状态徽标进标签页 + Problems/Notifications 分离 → 拖拽移动信号 → 全局 Undo/Redo → 悬停卡/图例增强 → 主题切换 + UI 偏好持久化 → 时钟节点内联编辑（foreignObject）→ 封装 90° 旋转/Bottom 翻转 → 板卡模型（`data/boards/`，Home「从开发板开始」入口）→ 运行时一等公民（blocking/embassy/rtic 单选）→ Export pinout 含/不含 AF → 分屏。

明确**不做**（超出定位或 CubeMX 也无）：C 工具链选择、Theia 级分屏、pack 正则布局、打印导出、多部件工程管理。

---

## 附：里程碑 × 差距报告索引

| 里程碑 | 消化 GAP P0 | 消化 CODEGEN-GAP P0 | 消化 P1 |
|---|---|---|---|
| M1 | 文档链接 bug | P0-1/2/3 全部 | 版本字段部分 |
| M2 | 8 项全部 | — | 快捷键、文档、参数分层部分 |
| M3 | —（P1 交叉） | — | NVIC/DMA/时钟锁定/参数补全/Check |
| M4 | — | — | 工程库/报告/IDE 产物/迁移/plan 预览 |
| M5 | P2 精选 | P2 精选 | — |

## 附：并行作战建议（沿用本次模式）

- **数据域**（`data/devices/*.json`）天然可按芯片×字段拆 4 份并行，validate:device 做门禁。
- **model 域**按模块切（codegen/clock/pins/conflicts），快照测试+差分脚本守等价性。
- **components 域**按视图切（pinout/clock/peripherals/codegen/common），浏览器截图验收。
- **集成**（我）：每次合并跑全量门禁 + `git-api-push`（github.com 被断时）+ 浏览器全视图走查。
