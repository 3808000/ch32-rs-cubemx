# ch32-rs-CubeMX 功能完善路线图（对标 STM32CubeMX2）

> **总体进度（2026-11-18）：M1–M14 十四个里程碑核心项全部完成。** 测试 380→1331，46 个子智能体分域并行 + 主控基座/接线/集成/实机取证/UI 对照修正/编译与射频阻塞攻坚。每个里程碑均通过 vue-tsc / eslint / validate:device / vite build / verify:build / 浏览器验收；M14 芯片扩至 **7 颗**（V003/V103/V203/V307/X035/H417/CH582M，verify blocking 6/6 + embassy 6/6 + BLE 1/1），BLE 实机连接建立打通（根因 #5：32K 域错配；GATT 卡点经手机对照定位宿主 AX210 适配器）。剩余为低优先 P2 与上游缺陷项（见各里程碑「暂缓」标注）。

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

## M5（v0.06+）体验打磨（P2 精选） ✅ 核心项已完成（2026-11-16）

> **落地状态**：引脚表升级（Used only/分页/列可见/行内 Assign）、Export pinout 含/不含 AF、Problems/Notifications 分离、每标签健康徽标、uiPreferences 持久化（引脚表/图例已接线）完成并推送（commits…ab8ed75）。664 测试全绿、verify:build 3/3、浏览器验收通过。**剩余 P2**（低优先，按需）：面板宽度持久化接线、全局 Undo/Redo、时钟节点内联编辑、封装 90°/Bottom 翻转、板卡模型、运行时候选、分屏、HTML 报告。

按价值排序：HTML 单文件报告（差异化卖点）→ 引脚表升级（Used only/Columns/分页/行内 Assign）→ 状态徽标进标签页 + Problems/Notifications 分离 → 拖拽移动信号 → 全局 Undo/Redo → 悬停卡/图例增强 → 主题切换 + UI 偏好持久化 → 时钟节点内联编辑（foreignObject）→ 封装 90° 旋转/Bottom 翻转 → 板卡模型（`data/boards/`，Home「从开发板开始」入口）→ 运行时一等公民（blocking/embassy/rtic 单选）→ Export pinout 含/不含 AF → 分屏。

明确**不做**（超出定位或 CubeMX 也无）：C 工具链选择、Theia 级分屏、pack 正则布局、打印导出、多部件工程管理。

---

## M6（v0.07）运行时与交互深化 —— 「配得全、改得快、看得清」 ✅ 已完成（2026-11-16）

> **落地状态**：7 项全部完成并推送。815 测试全绿（664→815，+151）、verify:build 3/3、validate 0 错、浏览器逐项验收通过（Runtime 双向切换+持久化 / Undo-Redo 快捷键+按钮+引脚/时钟操作入栈 / 拖拽搬移候选精确=remap 数据 / 90°+Bottom 任意角度文字可读 / 时钟内联 select+number+Esc / 面板调宽刷新保持 / 芯片搜索对比 / HTML 报告视觉验收）。子代理 N/O/P/Q/R/S 分域并行；Runtime 选择器、生成链/Undo 挂载、占位卡移除由主控亲自完成。**板卡功能按用户决定取消**（个人项目无厂商合作，版权风险），S 转向芯片选择增强。

> 来源：M4/M5 暂缓项 + 新发现的 UI 缺口（`features.embassy/debugPrint` 驱动生成器却无任何 UI 开关）。
> 作战模式沿用 M1–M5：主控基座/契约/接线 + 6 个子代理分域并行（N/O/P/Q/R/S）。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 6.1 | **Runtime 一等公民**：Project settings 新增 Runtime 段（blocking/embassy 单选 + debugPrint 开关；rtic 禁激活标注待核实；embassy 按 chip.unsupportedFeatures 禁用）；生成对话框显示当前运行时 | `views/ProjectSettingsView.vue`、`components/CodegenDialog.vue`（主控亲自做） | 浏览器：切换 embassy→生成 main.rs 含 embassy_executor；H417 embassy 禁用 | 主控 |
| 6.2 | **HTML 单文件报告**：`sel.htmlReport`（缺省 false）→ `report.html`（generated 组，随重新生成更新）：内联 CSS 无外部依赖，引脚全表/时钟/外设/中断/DMA/文件清单+哈希/生成元数据；HTML 转义防注入 | 新 `model/codegen/htmlReport.ts` + 模板；index/workspace/CodegenDialog 接线（主控） | 单测 ≥12；浏览器打开报告验收 | N：model/codegen |
| 6.3 | **全局 Undo/Redo**：配置快照栈（合并窗口+容量上限）；Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y；标题栏按钮；与引脚覆盖撤回共存（全局撤回时清覆盖栈）；换芯片/导入工程重置 | 新 `services/historyStack.ts` + `components/common/useHistory.ts` + `UndoRedoButtons.vue`；App/AppShell 挂载（主控） | 单测 ≥15；浏览器：配置→Ctrl+Z→Ctrl+Y 往返 | O：services+common |
| 6.4 | **封装交互深化（M4.8）**：拖拽移动信号（候选脚高亮+幽灵标签+落点搬移）；90° 旋转按钮；Bottom 镜像翻转（文字保持可读） | `components/PackageCanvas.vue` + 新 `model/pins/moveSignal.ts`；PinoutView 搬移 handler（主控已预接线） | 单测 ≥12；浏览器：拖拽换脚/90°/Bottom 验收 | P：PackageCanvas+pins |
| 6.5 | **时钟节点内联编辑**：number 控件 foreignObject 内联输入（Enter/blur 提交、Esc 取消）；select 控件内联下拉；锁定/fixed 不可编辑 | `components/clock/ClockNode.vue`、`ClockCanvas.vue`、新 `clock/inlineEdit.ts` | 单测 ≥10；浏览器：内联改分频→频率联动 | Q：clock 组件 |
| 6.6 | **面板宽度/可见性持久化 + 拖拽调宽**：接线已有 uiPreferences key（pinout/clock/peripherals 的 detail/code 宽度与可见性）；新增拖拽分隔条（夹取范围） | 三视图 + `PinConfigPanel/ClockDetail/CodePreviewPanel` + 新 `common/PanelResizer.vue` | 单测 ≥8；浏览器：调宽→刷新→保持 | R：views+panels |
| 6.7 | **Home 芯片选择增强**：新建 MCU 升级为可搜索芯片对比表（封装/引脚数/Flash/RAM/内核/target/工具链/生成支持徽标），数据全部来自仓库已有 chip.json | 新 `components/home/ChipPicker.vue` + `views/HomeView.vue` | 单测 ≥10；浏览器：搜索→选芯片→新建 | S：Home+ChipPicker |

> **已取消：板卡模型（原 6.7）**。用户决定：个人项目从未与厂商合作，引入厂商开发板数据存在版权纠纷风险，整个「从开发板新建」功能不做。子代理 S 已转向芯片选择增强（纯仓库数据，无外部版权内容）。

**M6 验收门禁**：664+ 测试全绿（新增 ≥70）；`verify:build` 三芯片仍过；embassy 工程端到端编译；浏览器全视图走查 + 推送。

---

## M7（v0.08）生成决议入页 —— 「一切决议在 Project settings，无二次弹窗」 ✅ 已完成（2026-11-16）

> 来源：用户指示 + 实机 CubeMX2 CDP 截图取证（Project settings → IDE Project Generation：General Setup 的 Format/toolchain/Destination 目录选择、Advanced 的目录映射与 **Automatic Conflict Handling Rules** 类别策略表、段末黄色 Generate 按钮；全程无决议弹窗）。
> **落地状态**：CodegenDialog / CheckDialog 两个弹窗删除；编排移入 `components/codegen/useGenerationFlow.ts`（含纯函数门禁 `generationGate`：error 阻止 / warning 需页内勾选）；CheckDialog 列表本体改为页内常驻 `PreflightPanel.vue`（条目点击定位不变）；Project settings 的 Code Generation 段成为唯一决议中心（子项复选/ includeMain / 档位 / IDE / 导出方式 ZIP|目录+目录选择 / 检查面板+警告确认 / 段末生成按钮）；目录导出两段式预览与逐文件冲突决议、生成结果报告均为页内折叠段；Pinout「导出工程」改为跳转 Project settings。823 测试全绿（+8 门禁测试）、verify:build 3/3、浏览器验收（跳转无弹窗 / 未勾选警告被阻 / 勾选后 ZIP 426 文件页内报告 / 截图对齐 MX2 形态）。主控亲自完成（单域重构，不派子代理）。
> **对齐差异（诚实记录）**：MX2 的冲突策略为类别级下拉（All: Update files on change / Custom…）；我们保留 M1 安全网的逐文件页内决议（用户手改默认 skip），类别级策略编辑列为后续 fidelity 项。

| # | 任务 | 改动落点 | 验收 |
|---|---|---|---|
| 7.1 | 生成编排 composable 化 + 门禁纯函数 | 新 `components/codegen/useGenerationFlow.ts` | generationGate 8 测试 |
| 7.2 | 检查面板页内化 | 新 `components/codegen/PreflightPanel.vue`；删 `CheckDialog.vue` | 浏览器：警告列表+定位链接页内可见 |
| 7.3 | Project settings 决议中心 | `views/ProjectSettingsView.vue` 重写 Generation 段 + 预览/结果段 | 浏览器：选项/门禁/ZIP 结果全页内 |
| 7.4 | 入口收敛 | `views/PinoutView.vue` 导出按钮跳转；删 `CodegenDialog.vue` | 浏览器：Pinout→settings 无弹窗 |

---

## M8（v0.09）主题对齐 + 冲突策略类别化 + 多信号模型 ✅ 已完成（2026-11-16）

> **落地状态**：3 项全部完成并推送。882 测试全绿（823→882：conflictPolicy 25 / exportPlan +4 / reservedPin 13 / signalsSelector 17）、verify:build 3/3、validate 0 错、浏览器逐项验收通过（主题取色对照实机 / 策略三档+custom 逐组+持久化入 cube.json / 选择器搜索+多 remap 档+分配+Reserved 标记与解除全链路）。子代理 T/U/V 分域（配额中断换 API 续作）；类型契约、controllers 策略状态、RESERVED 模型层（pinFilter/derive/reservedRules）由主控完成。
> **接受的设计差异（记录）**：左栏 active 保留品牌黄块（MX2 实机为蓝块、黄用于生成动作）；左栏宽 56px（MX2 约 61px）；标签起始贴左栏（MX2 留白约 300px）；选中签文字取实机采样蓝 #2a62b7。

> 来源：用户指示（左栏白/标签底板蓝/选中签白，对照实机截图）+ M7 遗留 fidelity 项 + M4.7 暂缓项。
> 作战：主控预置类型契约（PinMode+'RESERVED'、ConflictPolicy、RESERVED_PIN_IN_USE）+ 3 子代理分域（T 主题 / U 冲突策略 / V 多信号）。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 8.1 | **主题对齐 MX2**：左图标栏白底灰图标黄 active；标签底板深藏青、未选中浅字、选中白 raised；变量化 | `styles/tokens.css`、`IconRail.vue`、`TabStrip.vue` | 浏览器截图与 /tmp/mx2-*.png 逐项对照 | T |
| 8.2 | **类别级冲突策略**：Advanced「Automatic Conflict Handling Rules」master 三档（safe/update-on-change/custom）+ custom 逐组下拉；resolveGroupDefaults 纯函数；inspect/write 传 groupDefaults；逐文件决议优先；入 cube.json | `controllers/project.ts`、`services/{projectFile,exportPlan,projectExport}.ts`、`useGenerationFlow.ts`、`ProjectSettingsView.vue` | 单测 ≥18；缺省行为逐字节等价 | U |
| 8.3 | **M4.7 信号选择器 + Reserved**：SignalsSelector（搜索/分组 GPIO/AF 按外设/Analog/Reserved、当前徽标、多 remap 档）；PinMode RESERVED 全链路（状态 reserved/生成跳过/RESERVED_PIN_IN_USE 冲突）；右键与详情面板入口 | 新 `pinout/SignalsSelector.vue`、`PinContextMenu.vue`、`PinConfigPanel.vue`、`pinFilter.ts`、`codegen/derive.ts`、`conflicts/rules/` | 单测 ≥22；生成物不含 reserved 引脚 | V |

**M8 验收门禁**：823+ 测试全绿（新增 ≥40）；verify:build 三芯片；浏览器主题对照 + 策略下拉 + 选择器全流程；推送。

---

## M9（v0.10）芯片选择链路完善 —— 「对齐 MX2 创建向导，保持纯本地优势」 ✅ 已完成（2026-11-16）

> **落地状态**：3 项完成并推送。920 测试全绿（882→920：chipPicker +23+5 排序修复 / createWizard 13）、verify:build 3/3、浏览器全链路验收通过（向导 stepper/选中门禁/逐列过滤/排序/Columns/Export CSV/分页文案/第二步名称门禁+只读存储预览+MCU 回显/创建落地 m9-demo+H417/设置页只读+提示/生成页内报告回归/底部选择器 Continue 预选）。子代理 W 实施；**主控验收发现并修复 Flash/RAM 字典序排序 bug**（改容量字节数值排序 + 5 回归测试）。
> **保持的差异化**：纯本地秒建（不模仿 MX2 联网 setup 陷阱）；页内 GenerationReport（优于 MX2 toast）。

> 依据：[ANALYSIS-MX2-CHIPFLOW-GAP.md](ANALYSIS-MX2-CHIPFLOW-GAP.md)（CDP 实机全链路取证：三步向导/逐列过滤/排序/Columns/Export/分页/选中门禁/名称路径创建时定/联网 setup 陷阱/生成 toast）。
> 决策：补选型与创建向导差距；**不模仿联网 setup**（纯本地秒建=差异化）；**保持页内生成报告**（优于 MX2 toast）。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 9.1 | ChipPicker 升级：行选中+Selected 计数+Continue 门禁、表头排序、逐列过滤、分页+页大小、Columns 菜单、Export list CSV | `components/home/ChipPicker.vue` | 纯函数测试 ≥12；浏览器选型操作 | W |
| 9.2 | 两步创建向导：stepper + name 必填门禁 + 存储位置只读预览 + MCU 回显 + Previous/Cancel/Create | 新 `components/home/CreateProjectWizard.vue`、`HomeView.vue` | 测试 ≥8；浏览器全链路 | W |
| 9.3 | 设置页 General 名称/路径只读化（创建时定；改名走工程库 rename） | `views/ProjectSettingsView.vue` | 浏览器只读+提示 | W |

**M9 验收门禁**：882+ 测试（新增 ≥20）；verify:build 三芯片；浏览器 Home→向导→创建→Pinout→设置只读→生成 全链路；推送。

---

## M10（v0.11）空态门禁 + 桌面磁盘工程库 + 实机调试配置 ✅ 已完成（2026-11-17）

> **落地状态**：4 项完成。986 测试全绿（920→986：projectGate 13 / tabDocuments 20 / diskLibrary 16 / ideConfig 17）、verify:build 3/3、Tauri release 构建成功（podman fedora，2m08s）+ 二进制 smoke 存活、浏览器验收（空态仅 Home 无 ×/侧栏开标签才追加/× 关闭右邻激活/全关占位/标签条对照原版特写：底板全宽+首标签缩进左栏宽+左栏白底自标签栏下+白签蓝字灰×上圆角 6）。
> **10.1 布局修正记录**：X 初版把标签栏整体移到左栏右侧（过度修正）；对照用户提供的 MX2 特写后由主控改回**底板全宽、首标签缩进左栏宽度、左栏自标签栏下方开始**（MX2 真实结构），× 补键盘可达（role=button+tabindex+Enter/Space）。
> **10.3 核实层级（诚实）**：探针层通过（WCH-Link v2.12 枚举/serial/firmware），目标层未响应（debug pins 无目标）；launch.json 依 ch32rv 文档能力生成（attach/无 monitor/无 load），不宣称实机连通目标；wlink 0.1.3 无 gdbserver 源码核实。

> 来源：用户指示（未开工程左栏仅 Home 可点；标签栏最左不与左栏相交）+ M4.1/M4.5 暂缓项落地（用户已插 WCH-Link，可实机核实调试链；参考库 /home/teze/CH32/wchlink-rs 为烧录器，无 gdbserver）。
> 契约（主控预置）：store.projectOpened（初始 false）+ setView 空态守卫 + loadConfig 置 true + markProjectOpened()；初始 activeView='home'。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 10.1 | 空态门禁 + 布局：左栏贯通标题栏下、标签栏居其右不相交；未开工程左栏仅 Home 可点、标签栏仅 Home；Ctrl+Tab 序列适配 | `App.vue`、`IconRail.vue`、`TabStrip.vue`、`useHotkeys.ts` | 浏览器空态/开工程两态验收 | X |
| 10.2 | 桌面磁盘工程库：Tauri projects_root/read_text_file/remove_dir（路径守卫）+ 索引 projects.json + 桌面 autosave 落盘 + 向导第二步真实路径可编辑+Change + Home 磁盘库/最近 + 空态「打开当前工程」禁用 | `src-tauri/lib.rs`、`services/{projectStorage,recentProjects,desktop}.ts`、`CreateProjectWizard.vue`、`HomeView.vue` | 单测 ≥10；podman 构建；桌面 smoke best-effort | Y |
| 10.3 | launch.json：wlink 0.1.3 **无 gdbserver**（源码核实）→ 裁决改 **ch32rv 0.31.3** `ch32rv gdb`:3333；实机核实层级=探针层通过（WCH-Link v2.12 枚举/serial）、**目标层未响应**（debug pins 无目标，诚实标注不宣称连通）；vscode 档生成 launch.json（cppdbg **attach**、无 monitor/load——ch32rv 不支持 vFlash）+ tasks「烧录 (ch32rv)」「gdbserver (ch32rv)」三步流 | `model/codegen/ideConfig.ts` + 模板 + tests/ideConfig.test.ts(17) + HAL notes §12 | ✅ 966 测试绿；核实证据入 HAL notes | Z |
| 10.4 | **标签文档模型**（用户指示）：标签栏仅渲染已打开视图（初始仅 Home；侧边栏/菜单打开才追加）；全标签浏览器式 ×（active 常显/inactive hover）；样式按 MX2 修正（36px 连续标签/仅上圆角白签齐平/健康角标圆点替代 inline 徽标）；activeView 可 null + 占位 | `controllers/project.ts`、`TabStrip.vue`、`IconRail.vue`、`useHotkeys.ts`、`App.vue` | 单测 ≥10；浏览器两态+关闭/重开验收 | X2 |

**M10 验收门禁**：920+ 测试；verify:build 三芯片；浏览器空态/布局/向导桌面分支（浏览器回归）；Tauri 构建；推送。

---

## M11（v0.12）CH58x 后端立项 —— 「第二 HAL 后端，数据驱动分流」 ✅ 已完成（2026-11-17）

> **落地状态**：ch58x-hal 后端全链路接入。1077 测试全绿（986→1077：ch58xCodegen 72 / ch58xData 7 / halUnsupportedPin 6 / exportBackend 6 + chipPicker 更新）；verify:build 扩至 **4 芯片**（V003/V203/H417/CH582M）+ CH582M embassy 档，stable 1.100.0 / nightly 1.102.0 真实 cargo 编译通过；浏览器验收（CH582M 向导秒建→11 引脚 GPIO/UART0/SPI0 含 NSS/I2C/ADC→20MHz 新预设→blocking/embassy 双档页内生成+ZIP 78 文件含 vendor/ch58x-hal→设置页后端感知）。4 份调研子智能体 + 3 份实现子智能体（A codegen / B 数据+verify / C 导出+UI），主控契约预建+集成+两个真实编译阻塞攻坚。
> **契约**：[CH58X_BACKEND_CONTRACT.md](CH58X_BACKEND_CONTRACT.md)（HAL @611954e 逐字核实 + D1–D16 决策）；API 真相源记录 [HAL_API_NOTES §13](HAL_API_NOTES.md)。
> **两个真实编译阻塞（集成期攻坚，非臆造）**：①qingke 0.5.0 对原子 target 强制 compile_error——上游 qingke#9/ch32-hal#59 确认 WCH QingKe LR/SC 缺陷，**编译 target 改 riscv32imc**（critical-section 回退=上游认可修复；拒绝 unsafe-trust-wch-atomics；-C target-feature=-a 实测无效）；②blocking 档链接缺 `__pender`（HAL 非可选依赖 embassy-time-queue-utils 默认 integrated queue 引用 executor 符号）→ **generic-queue-8 feature 统一**。上游该 commit 在标准 imac 上当前不可编译，本工具不改 HAL 源码、以工程配置绕过。
> **工具链事故（诚实记录）**：rustup 1.29.3 自动更新致 stable 损坏→修复 1.100.0；verify 脚本隔离 HOME 未钉 RUSTUP_HOME 致残缺工具链家目录随机编译失败→脚本已修（RUSTUP_HOME 与 CARGO_HOME 同理钉回原位）。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 11.1 | ch58x 独立 codegen 管线：halBackend 分流；blocking/embassy 双档骨架（edition 2021/qingke-rt 0.5 直依赖/-Tlink.x/无 build.rs/memory.x）；GPIO（OutputDrive 约定映射）/UART0-3/SPI0（软件 CS/txonly/rxonly）/I2C/ADC（裸通道引脚）；时钟 6 预设+显式 PLL(div)；tasks 仅构建+wchisp（无 launch.json，CH58x 不在开源调试矩阵）；README 诚实能力边界 | `model/codegen/ch58x/**`（14 模板）、`tests/ch58xCodegen.test.ts`(72) | 生成物↔HAL 行号对照；cargo build 双档 | A |
| 11.2 | 数据修正+通用规则+vendor+verify：clock 补 20MHz/div 2..31；PB17 halUnsupported→HAL_PIN_UNSUPPORTED 通用规则；build-hal58x-vendor.mjs→public/vendor/ch58x-hal.zip（0.92MB，**入 git 与 ch32-hal.zip 同等待遇**）；verify 脚本 ch58x 分支+默认 4 芯片+RUSTUP_HOME 修复；entry 补 SPI/I2C 覆盖 | `data/devices/ch582m/*`、`conflicts/rules/pinRules.ts`、`scripts/*`、tests(13) | validate 4 芯片 0/0；zip 产出 | B |
| 11.3 | 导出分流+选择器+UI 标注：backendVendorZip 纯函数按后端选 zip；ChipPicker SUPPORTED_HAL_BACKENDS（CH582M 可生成）；设置页 Runtime/rev/工具链/entry 文案后端感知（主控补 rev 显示修复）；generationItemsFor 后端感知 | `services/projectExport.ts`、`ChipPicker.vue`、`ProjectSettingsView.vue`、`useGenerationFlow.ts`、tests(6+更新) | 浏览器双档生成+导出 | C |

**M11 验收门禁**：1077 测试；tsc/eslint/validate/build；verify:build 4 芯片 + CH582M embassy（显式工具链名，离线）；浏览器全链路；ch32 生成物快照不变；推送。

**暂缓/待核实**：CH58x BLE 协议栈生成（需 ble feature + LSE + 厂商库，独立里程碑）；CH58x 调试（MRS gdbserver 调研）；Timer/PWM/DMA（HAL 无驱动，待上游）；Vbat/温度内部通道（HAL enable_vbat 空操作不可信）；引脚参数 UI 后端感知（speed 标签仍 ch32 口径，生成映射已文档化）。

---

## M12（v0.13）CH58x BLE 协议栈生成 + 调试链 —— 「第二后端的功能纵深」 ✅ 已完成（2026-11-18）

> **落地状态**：BLE 三角色（peripheral 含简单 GATT 服务 / broadcaster / observer）数据驱动生成；1222 测试全绿（1098→1222）；verify:build 六路全过（V003/V203/H417/CH582M blocking/embassy/**--ble**，BLE 厂商库真实链接编译）；浏览器验收（BLE 节全参数 + 运行时互锁 + 新建工程默认 PLL 直接生成 + ZIP 75 文件 0 冲突）。6 个子智能体（3 调研 + 3 实现）+ 主控契约/集成/默认时钟修复。
> **契约**：[CH58X_BLE_CONTRACT.md](CH58X_BLE_CONTRACT.md)（src/ble/* 逐字核实 + D1–D12）；事实与实机状态 [HAL_API_NOTES §14](HAL_API_NOTES.md)。
> **调试链突破并实机闭环**：MRS V3.0.0 Linux 自带 WCH fork OpenOCD（wlinke+sdi+wch_riscv，CH58x 支持）部署用户目录；首次 attach 失败根因=CFG_DEBUG_EN=0；用户于 Windows WCHISPStudio「开启两线仿真」成功（证据存档 windows-side/）后 CH-LINK 接回 Linux，**examine + gdb 3333 attach 读寄存器/Flash 全通过**（misa=0x40901125、Flash 448KB、空片无有效固件）。IDE 生成 launch.json + openocd-wch 任务链（D9）实机等价验证完成。烧录待用户授权。
> **集成修复**：ClockData.defaultSource 数据驱动（CH582M 默认 PLL——旧默认 HSE 不可生成会阻止新建工程导出）；ch58x README/ide 旧断言同步 M12。
> **插曲（用户报告）**：Pinout/Clock 画布无法拖动/区域聚焦 → 光标锚定缩放 + 背景拖动平移（f17a3d7）；时钟卡片左对齐死区 → safe center 居中 + 跨溢出锚定补偿（0eae042）。

| # | 任务 | 改动落点 | 验收 | 并行域 |
|---|---|---|---|---|
| 12.1 | BLE codegen：generated/ble.rs 三角色脚手架（TMOS 泵/单订阅者/无原子/GATT 6 属性/CCCD/notify/断连恢复/名称三处同步/单位换算）；main.rs 用户区 hook；cargo ble features + embassy-sync；LSE 追加 | `model/codegen/ch58x/{ble,derive,clock,cargo,index}.ts` + templates、tests(70) | 生成物↔HAL 行号对照；--ble cargo 通过 | A2 |
| 12.2 | BLE 冲突规则（6 码）+ cube.json 宽松解析 + store 互锁 + 设置页 BLE 节（角色/名称字节计数/间隔/MAC/UUID16/observer）+ Runtime 互锁 | `conflicts/rules/bleRules.ts`、`projectFile.ts`、`controllers/project.ts`、`ProjectSettingsView.vue`、tests(38) | 规则正反用例；UI 互锁实测 | B2 |
| 12.3 | ch58x IDE 调试链：launch.json cppdbg attach + openocd-wch gdbserver/烧录任务 + release-debug 构建任务 + wchisp 备用；verify --ble | `ch58x/ide.ts` + templates、`scripts/verify-build*`、tests(13) | 六路 verify；任务逐字 | C2 |

**M12 验收门禁**：1222 测试；tsc/eslint/validate/build；verify 六路；浏览器 BLE 全链路；ch32 快照不变；推送。

**暂缓/待核实**：central 角色（上游无示例）；配对策略/复杂 GATT 表/扫描过滤留用户区；MTU>23/TX 功率配置（HAL 硬编码）；CH582M 两线调试开启（用户硬件操作后补实机 attach/烧录核实）；BLE 实机射频验证（需调试口或 ISP 烧录后观察广播）。

---

## M13（v0.14）CH58x BLE 实机化 —— 「从编译通过到射频上天」 ✅ 已完成（2026-11-17 深夜）

> **落地状态**：Rust 生成的 BLE 固件在 CH582M 实机广播成功（bluez 扫到 `CH582M` @ 出厂 MAC 0C:3D:5E:A6:62:94）。1236 测试全绿；verify 六路含 --ble（stable）；官方 C hex 对照实验分离硬件/软件根因。四个实机根因全部生成器侧修复（未改 HAL 源码）：MIE 启动补位、busy-poll 运行时（绕 embassy SysTick/WFI 缺陷）、LSI 缺省（绕强制 LSE）、广播 flags 补 GENERAL discoverable 位（bluez 过滤根因，最后一片拼图）。
> **证据链**：HAL notes §14.2bis/ter（寄存器级诊断：PFIC/向量表/RTC/PLL/SysTick 实测 + C 运行态对照）；契约 D17–D19。
> **用户协作**：Windows WCHISPStudio 开启两线调试（官方工具，证据存档）；官方 EVT/BleLib zip 提供；CH-LINK/USB 接线操作。
> **插曲答疑**：480MHz=PLL VCO（sysctl.rs:9 + 手册 §7 + CLK_SYS_CFG 寄存器三重证据），总线=480÷div≤80MHz。

| # | 任务 | 改动落点 | 验收 |
|---|---|---|---|
| 13.1 | busy-poll BLE 运行时 + MIE 补位 + LSI 缺省 + stable 工具链 | ch58x templates/{mainRs,bleRs,clockRs,cargoToml,rustToolchain}、index/clock/readme、UI BLE 节 | 83+ 用例；verify --ble stable |
| 13.2 | RF ISR 接线（BLEL/BLEB→库 ISR）+ flags GENERAL 位 | bleRs.ts、ble.ts advDataItems | 实机 bluez 扫到 CH582M |
| 13.3 | 对照实验与诊断归档 | docs §14.2bis/ter、契约 D17–D19 | C hex 对照 + 寄存器证据 |

**暂缓**：central 角色、配对策略 UI、MTU>23、BLE+GPIO 异步共存、中断模式 BLE（PFIC 使能路径）、上游 issue 提交（证据包已备）。

---

## M14（v0.15）三芯片接入 + BLE 连接闭环 —— 「加芯片=JSON 的架构验证 + 广播之上建连接」 ✅ 已完成（2026-11-18）

> **落地状态**：CH32V103C8T6 / CH32X035C8T6 / CH32V307VCT6 三芯片全链接入（数据手册级引脚表 + HAL 逐字时钟核实 + 真实 cargo 编译）；BLE 连接建立实机打通（根因 #5：32K 域错配），**手机对 Rust 发货固件 GATT 读写成功——BLE 全链路实机闭环**；宿主 bluez GATT 卡点经手机对照定位 AX210 适配器。**1331 测试 / 60 文件**全绿；verify:build blocking **6/6** + embassy **6/6** + BLE **1/1**；validate:device **7 芯片 0/0**；浏览器验收三芯片页内生成 0 冲突。4 个实现子智能体分域并行（主机重启中断后由主控收尾集成）+ 2 个调研子智能体。
> **契约**：[M14_CHIP_INTAKE_CONTRACT.md](M14_CHIP_INTAKE_CONTRACT.md)（D1–D12）；BLE 修复 [CH58X_BLE_CONTRACT §3ter](CH58X_BLE_CONTRACT.md)（D20–D22）；证据 [HAL_API_NOTES §14.2quater](HAL_API_NOTES.md)。
> **架构结论**：「加芯片=JSON」基本成立——V103/V307 纯数据接入；X035 退化时钟（无 PLL/HSE，仅 AHB 分频）触发一次**通用**模型扩展（pll 可选/prediv 除法/SYSCLK ADC 源/targetSpec 数据驱动），扩完后同类芯片仍纯 JSON。V307 硬浮点 imfc 自定义 target + nightly/build-std 由 chip.json targetSpec 驱动（V003 旧路径逐字节不变）。
> **BLE 根因 #5（实机）**：M13「板无 LSE」系误判（用户证实板载晶振）；移除 enable_lse 造成硬件 LSI / 库 LSE 错配 → 广播正常但连接必败。修：`ble.clock32k` 选项（缺省 lse：enable_lse + stack_init SelRTCClock=0，连接建立实机 ×3 验证；lsi 回退保留）+ 连续轮询无 delay（对齐官方 C）+ SysTick notify 时基（弃 TMOS_GetSystemClock 每圈 u64 软除法）。
> **宿主适配器定位（对照实验）**：官方 C hex 与 Rust 固件在宿主 bluez 上 GATT 发现同样慢/掉线；内核每次连接报 `Unexpected continuation frame`；**手机 nRF Connect 对 C 固件秒级发现 FFE0+FFE1–FFE5、读写成功** → Intel AX210 LE 数据通路问题，非固件。Rust 固件手机端到端验证：**FFE1/FFE2 读写成功（用户实测）**，notify 周期待实测确认。
> **工具链教训**：wlink flash 无 verify 产坏镜像（一律 OpenOCD program verify）；wlink dump 外设读不可信（gdb 为准）；WCH-Link 自发 USB 掉线需先确认在线再取证。

| # | 任务 | 改动落点 | 验收 |
|---|---|---|---|
| 14.1 | 三芯片数据（引脚/时钟/外设/EXTI/remap/irq/dma） | data/devices/{ch32v103c8t6,ch32x035c8t6,ch32v307vct6}/**、importer 运行 | validate 7 芯片 0/0；数据测试 ×3 |
| 14.2 | 时钟模型通用扩展 + targetSpec + verify 7 芯片 | model/clock、types/{clock,chip}、codegen/cargo、scripts/verify-build* | prediv/无PLL/SYSCLK 测试；V003 快照不变；blocking 6/6 + embassy 6/6 |
| 14.3 | 注册表 + UI + 集成缺口 | model/device.ts、chipPicker 测试更新、verify entry I2C-DMA 守卫（V103 上游无 I2C DMA） | 浏览器三芯片全链路；1331 测试 |
| 14.4 | BLE 连接闭环（clock32k + stack_init + 连续轮询 + SysTick notify） | ch58x templates/{bleRs,clockRs,readme}、ble/clock/index/derive、types/project、projectFile、ProjectSettingsView | 连接建立实机 ×3；verify --ble；手机对照定位宿主 |

**暂缓**：LSI 校准移植（Calibration_LSI 寄存器级，StdPeriphDriver）、宿主 AX210 修复/换 dongle、central 角色、配对策略 UI、V103/V307 非预设 PLL 显式导出（explicit 不写 cfg.pll，M15）、X035 AHB÷5..256 显式导出、上游 issue 已提交（2026-11-18）：[qingke#42](https://github.com/ch32-rs/qingke/issues/42)（MIE 启动）· [ch58x-hal#13](https://github.com/ch32-rs/ch58x-hal/issues/13)（embassy SysTick 时间驱动）· [ch58x-hal#14](https://github.com/ch32-rs/ch58x-hal/issues/14)（ble::init SelRTCClock 硬编码）。

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
