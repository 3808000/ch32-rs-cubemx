# CubeMX2 功能差距分析（视图与交互）

> 对照对象：STM32CubeMX2 1.1.1（本机实机运行） vs ch32-rs-CubeMX
> 范围：**视图组织、面板/标签、引脚/外设/时钟交互、工程与生成 UI、状态反馈、辅助功能**
> 不含生成器内核与文件组细节（见 `docs/ANALYSIS-MX2-CODEGEN-GAP.md`）。本文只分析，不改动任何 `src/` 代码。

---

## 0. 信息来源与可信度说明

| # | 来源 | 位置 | 提供的信息 | 可信度 |
|---|---|---|---|---|
| S1 | **CubeMX2 1.1.1 实机（CDP）** | `http://127.0.0.1:9222`，page `74EF757F1D10AC2CB311C8A063E58618` | 真实菜单、标签页、视图切换后的 DOM 文本、按钮/下拉选项、对话框文案；只读 DOM + 截屏 + 轻量视图切换 | **一手（实机）** |
| S2 | CubeMX2 前端源码（source map 还原） | `dist/resources/app/lib/frontend/bundle.js.map` → 提取到 `/tmp/mx2src` | Pinout/Clock/Peripherals/Project Export/Menu 的 React 源码、命令 ID、快捷键实现、空状态/告警逻辑 | **高**（与 1.1.1 同源；比截图更精确） |
| S3 | CubeMX2 工程快照 | `/home/teze/CLionProjects/TEST.ioc2`（98 KB，3506 行，22 个内嵌 store） | 项目模型分区：pinout/clock/nvic/dma/exti/peripherals/sw-composition/sw-configuration/export-settings 等；用于判断“状态/配置域”齐全度 | 一手（真实工程） |
| S4 | CubeMX2 参考截图 | `reference/mx2-ui/01..06*.png` | 1.x 早期视觉基准：Home 最近工程、Pinout 图/表、Clock、外设页、图例 | 中（版本未标；仅作视觉参考） |
| S5 | 录屏 | `/home/teze/视频/录屏/录屏 2026-11-15 20-33-36.mp4`（6.7 s） | 仅展示 Pinout 45° 倾斜与缩放、标签页、Detail view 图例；**功能流信息很少** | 低（本次重看未获得新流程） |
| S6 | CubeMX1 工程 | `/home/teze/CLionProjects/model/{model.ioc,.mxproject,Core/}` | 旧版 ProjectManager 字段、生成区/用户区约定（只作演进对照） | 一手（旧版） |
| S7 | 我方代码 | `/home/teze/CH32/CubeMX/ch32-rs-cubemx/src/**` | 现状逐文件核对 | 一手 |
| S8 | CubeMX2 官方文档 | `https://dev.st.com/stm32cube-docs/stm32cubemx2/1.1.1/en/index.html` | 尝试抓取，网络超时（curl exit 28），**未采用** | 不可用 |

**判定口径**

- “实机”= S1 直接观察；“源码”= S2 逐行确认；“实机工程”= S3 配置字段。三者冲突时以实机为准。
- 未在 1.1.1 实机/DOM/源码中出现的能力，写“未发现”，不写“没有”；推测项显式标注「推测」。
- 版本差异：参考截图（S4）与实机 1.1.1 有少量出入（如左侧栏项、Clock 搜索框），报告以实机/S2 为准。

---

## 1. 逐项差距表

### 1.1 视图与导航

| 能力 | CubeMX2 行为（实机/源码） | 我们现状 | 差距 | 优先级 | 实现要点 |
|---|---|---|---|---|---|
| 主视图集合 | 左侧栏：Home、Pinout、Clock、Peripherals、Middlewares & Utilities、Parts、Project settings、Generate（动作）、Pack manager、Settings；每个对象再开独立标签页（实机打开 USART2 后出现 `USART2` 页） | 仅 Home/Pinout/Clock/Peripherals 四个固定视图（`src/controllers/project.ts` 的 `ViewId`） | 缺 Per-object 标签页、Project settings 主视图、Middleware/Parts/Pack 等视图 | **P0** | 先把 `activeView` 升级为“固定视图 + 可关闭的文档标签”模型（`{kind:'view'| 'peripheral'|'project-settings', key}`），Peripherals 不再用卡片流承载全部实例 |
| 左侧栏组织 | 10 个入口，分上下两组；Pinout/Clock/Peripherals/Middleware/Parts/Project/Generate 在未打开工程时置灰，Settings 常驻；图标 + tooltip | 4 个视图 + 底部 Help/Settings；无置灰态、无分组、无 Generate 动作 | 信息架构与可用状态不一致 | P1 | `IconRail` 增加 `disabled`/分组/分隔线；Generate 作为“动作项”而非视图；未载入工程时禁用配置类入口 |
| 标签页 | 浏览器式标签：可关闭（×）、可 `Ctrl+Tab`/`Ctrl+Shift+Tab` 切换、`Ctrl+Alt+P` 关闭；对象页标题即外设名 | `TabStrip.vue` 固定 4 个按钮，不可关闭；dirty 红点只标当前页 | 无对象页、无关闭/切换快捷键、无“未保存页”粒度 | P0（对象页） / P2（关闭快捷键） | 标签模型与路由分离；标签携带 `dirty`/`health`；关闭前脏检查 |
| 菜单栏 | 真实下拉：Project（Create from MCU/Board、Open from File System、Open Recent、Save Project、Save As、Close、Preferences、Exit Ctrl+Q）；View（Zoom、Output、Next/Prev/Close Tab）；Help（About、Documentation 子菜单、Packs & Licenses、Issue Reporter） | `AppShell.vue` 三个按钮是“伪菜单”：工程=直接保存，视图=无动作，帮助=About；`Settings` 按钮实际打开“快捷键”对话框 | 新建/打开/最近/另存/关闭/偏好/文档/问题反馈都没有入口 | **P0** | 菜单用真实 popover（或 Element Menu）；先接通 Project/Help 两组，View 的 Tab/缩放可后置 |
| 页面头与层级 | 每个标签页头：`Pinout` + `芯片 封装`；外设页头为外设名；右侧统一 `Open STM32 documentation` | 各视图有标题 + 芯片副标题；外设页是“全部卡片流”，没有对象页头 | 对象上下文弱；文档入口不按芯片 | P1 | 页头组件化，标题/副标题/文档 URL 由对象上下文注入 |
| 最近工程/打开 | Home 有 Last Opened + Recent projects 卡片：`.ioc2` 路径、板名/MCU、文件大小、Last opened/modified、Last modified with MX2 版本；Project 菜单可 Open Recent | Home 是 4 张入口卡 + 芯片列表；项目只有一个 localStorage 快照；无最近工程、无工程路径展示 | 多工程工作流缺失，无法在工程间切换 | **P0**（并入 P0-8） | 工程注册表（桌面端可扫目录/JSON 索引）；Home 增加最近工程卡；打开时恢复窗口标签 |
| 分屏 | 每个视图工具栏有 `Split right`，菜单含 Default/Split left/up/down；标签可拖到分屏 | 仅 Pinout/Clock/Peripherals 的 `CodePreviewPanel` 左右拖宽；无标签分屏 | 无法“引脚图 + 时钟树”或“外设 + 代码”并排 | P2 | 引入 dock/split 容器（可先用 CSS grid 两栏 + 标签拖放），不要求 Theia 级能力 |
| 跨视图跳转 | 引脚右键 `Configure USART2` → 外设页；时钟节点右键 `Configure RCC`；外设页 Quick menu 定位表单章节 | 冲突面板点击只 `selectPin + setView('pinout')`；QuickMenu 是外设目录（滚动到卡片） | 没有“从信号/节点跳到其配置对象”的双向导航 | P1 | 统一 `openPeripheral(id, sectionId?)` / `openClockNode(id)` 命令；冲突与右键菜单复用 |

### 1.2 引脚交互

| 能力 | CubeMX2 行为（实机/源码） | 我们现状 | 差距 | 优先级 | 实现要点 |
|---|---|---|---|---|---|
| 搜索框 | 左侧是“搜索类型”下拉（All/Pin/Signal/Label/Position），右侧输入；输入后出现建议列表（带匹配数与引脚位置），可逐条“匹配导航”；大小写不敏感；图形/表格共用同一过滤条件 | `PinoutToolbar` 单个输入，仅按 `store.assignments` 的 pin/function/label 过滤**已配置引脚**；`PinTable` 另有独立搜索；未配置引脚不可搜 | 搜索语义错误（应过滤“引脚集合”而非“配置集合”）、无类型/建议/导航、图表不同源 | **P0** | 建立 `PinFilter`（searchType+text+selection+state+type+io）作为单一真相；图形与表格都消费它；建议列表用现有设备数据生成 |
| Show 状态过滤 | 实机下拉 9 项且带计数：All 64、Configured 3、Reserved 6、Unassigned 43、Not configurable 12、Pinned 7、Excluded 0、Error 0、Warning 0；可多选 | `showFilter` 绑定在 `PinoutView`，但**从未参与任何过滤**（死控件）；另有一个 Type 下拉 | 最常用的“只看已配置/只看冲突”缺失；存在明显无效 UI | **P0** | 先实现状态派生函数（configured/reserved/unassigned/notConfigurable/pinned/excluded/error/warning），过滤在图形与表格共用；计数实时计算 |
| Type / I/O structure | Type 下拉分三段：Pin function（GPIO/analog/boot/power_supply/reset，带计数）、Pin type（I/O、S）、I/O powered by（VDD）；I/O structure 分 Voltage Tolerance（FT/RST/TT）与 Pin Options（a/f），均带计数 | Type 只有 All/IO/POWER/NC；I/O structure 不存在；`ChipPin` 只有 `type/special/ft/adc/aliases`，无 ioStructure/options/powerSource/function 分类 | 无法按电气属性筛选（5V 容忍、开漏能力等） | P1 | 扩展 `chip.json` 引脚字段（`ioStructure`/`options`/`powerSource`/`functions`），过滤组件支持多段多选 |
| 右键菜单 | 实机 PA2 右键：分组信号清单（GPIO mode、Alternate signals、Reserved、Analog signals、Additional signals）→ `Assign signal`、`Move signal`、`Configure USART2`、`Edit label`、`Exclude pin`、`Reset Pin State`（确认框） | 画布只有左键选择/配置；无 `contextmenu`、无任何批量/移动/排除动作 | 高频操作全部缺失，只能逐个下拉配置 | **P0** | `PackageCanvas` 增加 `@contextmenu` + 复用弹出菜单组件；动作先接 Assign（复用 `PinConfigPanel`）、Configure、Reset、Exclude |
| 拖拽移动信号 | 悬停浮卡提示：按住左键显示 alternate pins；按住左键拖动可把信号拖到兼容引脚；不兼容引脚有不可放置反馈 | 无拖拽、无 alternate pin 高亮 | 换脚需要“清除再配置”，易产生中间冲突 | P1 | 选中已配置引脚时计算 `assignablePins`（同信号/同 remap 的候选），拖动命中后走 `usePinOverwrite` |
| 多选/批量 | 1.1.1 未发现多选；批量能力是 `Reset pins`（全局）与按状态过滤后逐脚操作（源码/DOM 未见 `selectedPinPositions`） | 单选；`Reset pinout` 全局重置 | 无差距（两边都无多选）；不建议优先做 | P2 | 如后续需要，用 Ctrl/Shift 多选 + 批量 Assign/Reset；当前不做 |
| 信号列表弹窗 | `SignalsSelector`：可搜索、按 GPIO/Alternate/Reserved/Analog/Additional 分组、复选多个信号、`pinned` 图钉、Reserved↔Configured 切换、多 pad（multi-bonding）选择 | `PinConfigPanel` 是单个 `el-select`（AF）+ Remap + 只读标签；一个引脚只能一个 function | 不支持一引脚多信号、pin/保留态、信号搜索与分组 | P1 | 把 detail 的“信号”区改成带搜索/分组/多选的列表；数据层先允许 `signals[]`，再迁移冲突规则 |
| 引脚状态与徽标 | PinTag（GPIO/POWER/RESET）、状态图标（warning/error）、pinned 图钉；图例覆盖：Unassigned/Not configurable/Configurable/Assigned/Reserved/Configured/Pinned/Excluded/Error/Warning/Board assigned/Board unassigned（含分组标题） | `pinColors` 仅 6 种视觉状态（gpio/af/special/power/conflict/unassigned）；无图例、无状态文字、无 pinned/excluded 概念 | 用户无法理解颜色含义，也不知道引脚处于 Reserved/Configured 哪一态 | **P0** | 定义 `PinState` 枚举 + 图例组件；图形/表格/详情/悬停共用；图例可折叠并持久化展开状态 |
| 悬停浮卡 | 延迟 100 ms 出现；`#position - name`、PinTag、状态图标、pinned、labels、Pin state 图例、操作提示（Show alternate pins / Drag & drop） | `PackageCanvas` 有 hover 卡：类型/特殊/模式/信号/remap/标签/ADC | 内容偏“配置摘要”，缺状态/图例/操作提示 | P2 | 在现浮卡上加状态行、labels 列表、pinned 图标与操作提示；保持 pointer-events:none |
| 键盘操作 | Pinout Shortcuts：Tab 聚焦引脚、Enter 选择、Escape 取消、Backspace 翻转封装、PageUp/PageDown 旋转、Home 居中、方向键滚动、Shift+滚轮横滚、Ctrl+滚轮缩放、Ctrl+Alt+± 缩放 | 无画布键盘处理；`App.vue` 快捷键表写了 Esc，但**没有对应 handler** | 键盘可达性缺失，且帮助文档与实现不一致 | P2 | 画布容器 `tabindex=0` + roving tabindex；先实现 Esc/Home/PageUp/PageDown；删除或实现文档中的 Esc |
| 表格视图 | `Used only` 开关（默认关，显示 64 行）、`Columns` 列选择、列 Pos./Pin/Status/Signals/Labels/Board/Actions、行内 `Assign signal...`、分页 25/页、`Selected: #16 - PA2`、Detail 联动 | `PinTable` 固定 10 列（#/引脚/类型/边/模式/信号/Remap/标签/可用信号数/特殊）；无 Status、无 Used only、无列选择、无分页、无行内编辑、无 Actions、无 Board | 表格只读且信息维度与 MX2 不同，无法承担“批量配置视图” | P1 | 先加 Status/Used only/分页/行内 Assign；Columns 选择与 Board 列依赖数据模型扩展 |
| 导出引脚表 | `Export pinout` 弹菜单：`Without Alternate Functions` / `With Alternate Functions`，保存 CSV | 单个 `Export pin…` 按钮，固定输出 number/name/mode/function/remap/label CSV | 缺少“不含 AF”的简化版；无导出选项 | P2 | 菜单二选一，复用现有 CSV 生成；文件名带芯片与日期 |

### 1.3 外设交互

| 能力 | CubeMX2 行为（实机/源码） | 我们现状 | 差距 | 优先级 | 实现要点 |
|---|---|---|---|---|---|
| 外设树分类 | 实机 9 类：Cortex 5、System 10、I/O 2、Analog 5、Timers 8、Connectivity 13、Computing 2、Memory 3、Security 4；分类可折叠、带计数 | `derivePeriCategories` 只有 Connectivity/Analog/Timers/System 四类；实例来自 peripherals.json + remap 推导 | 分类维度少，系统类（NVIC/DMA/EXTI/RCC/DBG）没有入口 | P1 | 数据层给实例加 `category`；先补 Cortex/System/I/O/Computing/Memory/Security 的空壳与计数，再逐项接配置 |
| 列表过滤/排序 | 搜索 `Search peripherals by name`；`Filter by`（Ascending/Descending alphabetical、Category）；`Show`（All/Active/Inactive） | 搜索 + 分类下拉 + `showAll` 布尔开关；列表项只有启用小圆点 | 无排序模式、无 Active/Inactive 过滤 | P1 | 用三态/两段过滤（显示方式 + 状态）；`showAll` 改为 `All/Active/Inactive` |
| 实例打开方式 | 从左侧选一个外设 → 打开**该外设的独立标签页**；未选时显示 `No Peripheral Selected` 占位页；再次打开时恢复上次查看的外设 | 所有可配置实例以卡片流同时铺在中栏；右侧另挂 4 个汇总 tab；选中只滚动定位 | “当前正在配哪个外设”不清晰，页面随实例数量线性变长 | **P0** | 每个实例一页；列表点击只负责开页；中栏改单实例配置；保留“概览/汇总”作为独立页 |
| Mode 与 Activate | 多模式外设（USART2 实机：Disable/Async/Sync/IrDA/SmartCard）必须先 `Select mode`，再 `Activate`；单模式直接 Activate；Deactivate 有确认框；提示“所需依赖可能自动安装”；未激活页显示 `Peripheral Not Configured`，参数区禁用 | `PeripheralConfigCard` 直接 `Activate`/`Deactivate`，无 mode；激活时按 remap 自动分配核心 AF 引脚；停用时逐个清引脚并确认 | 缺“模式”这一层，参数集合无法随模式变化；停用语义偏重（清引脚） | **P0** | 数据层给外设加 `modes[]`（名称 + 参数集 + 引脚需求）；UI 先选 mode 再 Activate；Deactivate 只关驱动，不自动清引脚（或单独确认） |
| 参数设置层级 | 外设页两张卡：`Peripheral`（分类/名称/Active 标签/Deactivate）+ `Parameter Settings`（可折叠 section/subsection，如 General information → label/software label/resource init codegen；Main features → Time-base → Clock/Counter、Sampling clock、DTS prescaler；信息图标 tooltip）；`Collapse all/Expand all`；Quick menu 按章节跳转 | `ParamSettings` 把 `params` 平铺为 key-value 表单；无二级分组、无说明、无软件 label/初始化代码策略 | 参数多时难找、难理解；生成策略无 UI | P1 | `params` schema 增加 `group/subgroup/label/help/advanced`；表单递归渲染；Quick menu 改为“章节导航”（与 MX2 语义一致，见下） |
| 激活状态提示 | 页顶 `Peripheral Not Configured` 信息条；卡片右上 `Warning` 标签（可点击复位已关闭警告）+ 每外设 `Configuration warning/error` 告警，可关闭 warning | 卡片内 `el-alert` 信息条 + `ConflictList`；状态徽标 Active/Display | 缺“本页警告可关闭/可恢复”、缺页级 Diagnostic 列表 | P2 | 每外设维护 `diagnostics`，页顶 Alert 可关闭并在下次修改时恢复；与全局冲突面板去重 |
| 外设页工具栏 | `Open STM32 documentation`、`Collapse all`、`Split right`、`Quick menu`、`Code preview`（可禁用） | 页头有文档链接（硬编码 CH32V003）、`Collapse/Expand all`、`Quick menu`、`Code preview` | 基本对齐；差 Split、文档按芯片、Quick menu 语义 | P2 | 文档 URL 按芯片数据注入；Split 复用 1.1 的分屏；Quick menu 改为章节导航 |
| Quick menu 语义 | 当前对象的**章节索引**（Project settings 实机：TEST/General/Hardware/Software/IDE Project Generation/General Setup/Advanced/Packs/Global services），点击滚动到对应 section | `QuickMenu` 是“外设目录”（分类→实例），点击滚动到卡片 | 同名不同义；当前实现与左侧列表重复 | P1 | 改为通用 `SectionQuickMenu`：从 DOM/section 元数据生成树，供外设页与 Project settings 共用 |
| 只读实例（TIM 等） | 所有实例都可点开配置；定时器有完整 mode/channel 配置 | 定时器等无 peripherals.json 定义，只显示 remap 信号映射表（Display） | 定时器/PWM 等无法配置 | P1 | 扩展 peripherals.json 到 TIM/EXTI 等；在数据未齐前保持 Display 并明确标注“仅查看” |
| NVIC/DMA/EXTI | 系统外设独立入口（Cortex/System 分类），NVIC 有优先级分组/中断表，DMA 有通道分配，EXTI 有线路分配；配置写入独立 store | 有 EXTI 分配面板、ADC 通道面板；无 NVIC/DMA UI；interrupts/dma 数据仅供 codegen/冲突检查 | 中断优先级、DMA 通道无法在界面配置 | P1 | 先做 NVIC 表（IRQ/优先级/使能）；DMA 后置；两者复用“分配面板”模式 |

### 1.4 时钟交互

| 能力 | CubeMX2 行为（实机/源码） | 我们现状 | 差距 | 优先级 | 实现要点 |
|---|---|---|---|---|---|
| 树覆盖范围 | 实机节点覆盖 LSE/LSI/HSE/HSI、RTC/IWDG、MCO1/2、I3C/SPI/DAC/LPUART/CRS/USB、AHB/APB1-3、Cortex/System Timer 等；几乎所有外设时钟 mux 都在树上 | `buildClockTree` 只覆盖 sources/PLL/SYSCLK/AHB/APB1/APB2/ADC/TIM 域；外设时钟多用固定推导 | 树不完整，用户无法看到/调整外设时钟源 | P1 | 数据驱动扩展 `clock.json` 的 mux/prescaler 节点；布局支持多列分组；未支持的节点显示“固定/派生”徽标 |
| 节点内编辑 | 频率选择是节点内原生 `<select>`（HSE 8/16/24/32/48 MHz）、单位 `<select>`（KHz/MHz/ms/µs）、mux 是节点内 radio；改动即提交后端重算 | 节点只显示值；点击控件行弹 `ClockPopup`（select/number）再提交；单位固定 MHz 显示 | 多一次点击；无单位切换；无“节点内 radio” | P1 | 在节点内直接渲染 select/radio（SVG foreignObject）；保留 popup 作为窄屏兜底 |
| 频率徽标/上限 | 每个输出显示频率 + `max: 144 MHz` 等约束；越界节点/连线红色，问题节点有 issue marker，hover 显示消息 | 节点按 error/warning 着色；detail 显示上限；问题列表可定位 | 基本对齐，但缺节点 hover 问题消息、缺连线越界高亮 | P2 | `ClockNode` 增加 issue marker + title/tooltip；wire 依据 source/target 问题着色 |
| 锁定配置 | 右键节点菜单 `Lock clock config`/`Unlock clock config`；锁定的节点禁止编辑（select disabled） | 无锁定概念 | 无法保护关键时钟不被预设/解算改动 | P1 | `ClockConfig` 增加 `lockedNodes[]`；控件 disabled；预设/解算跳过锁定节点 |
| 路径高亮 | 右键 `Highlight all paths` / `Highlight source` / `Highlight endpoint(s)`；工具栏 `Clear selection(s)` | 搜索仅对非匹配节点做 dim；无路径高亮/清除 | 追踪时钟来源/去向困难 | P2 | 基于 edges 做 BFS 高亮；工具栏加 Clear |
| Resolve clock issues | 工具栏按钮三态：`Resolve clock issues`（有错）/`No clock issues`（无错）/转圈（求解中）；点击调用后端自动求解；节点 issue marker + hover 文本 | 按钮打开“时钟问题”对话框，列出 issues，点击定位；**不做自动修复**；按钮始终可点 | 缺“一键自动修复”；错误展示不如节点内 marker 直观 | P1 | 复用 `solvePll`/约束搜索做 auto-fix；无解时回退问题列表；按钮状态随 `validateClock` 变化 |
| Reset clock | 弹确认框：`Reset Configuration / This will restore all settings to their default values. Your current configuration will be lost.` + `Don't ask again` | 直接 `store.resetClock()` + toast，无确认/不再询问 | 误点即丢失配置 | P2 | 复用统一 ConfirmDialog；`don't ask again` 存偏好 |
| 表格视图 | 列 Id/Type/Value/Range/Unit/Output Frequency/Actions；Value 可编辑、Unit 可选、Actions 含锁定；越界值高亮；支持排序/列设置 | 表格只读：节点/ID/输入/输出/上限/状态；点击只定位节点 | 表格不能编辑，无法替代图形视图 | P1 | 复用 `applyClockControl`，Value/Unit 走同一命令；加 Actions（锁定）列 |
| Detail view | 选中节点显示详情；无选中显示 `No selection yet / Select an item on the clock tree to view details here`；可开关（持久化） | `ClockDetail` 显示节点参数、预设、目标频率解算、问题列表；宽度固定 | 我们多出“预设/目标解算”（MX2 实机未见），少“无选中空态”的轻量提示（有默认文案） | P1（MX2 缺的能力可保留） | 保留预设/解算作为差异化；补空态与面板开关持久化 |
| 搜索/快捷键 | 搜索 `Search configurations, settings...`，支持清除与高亮；Shortcuts 面板：Space/中键拖拽、方向键滚动、Ctrl+滚轮缩放、Ctrl+Alt+± 缩放 | 搜索框存在，非匹配节点 dim；仅 Ctrl/⌘+滚轮缩放；无拖拽/方向键/Shortcuts 面板 | 画布导航能力弱 | P2 | 加 hand 模式/空格临时抓手、方向键滚动、Shortcuts 弹层 |

### 1.5 工程与生成 UI

> 生成器内部（模板、文件组、迁移、覆盖算法）见 `docs/ANALYSIS-MX2-CODEGEN-GAP.md`；本节只看用户能看到的界面。

| 能力 | CubeMX2 行为（实机/源码） | 我们现状 | 差距 | 优先级 | 实现要点 |
|---|---|---|---|---|---|
| Project Manager 视图 | **主标签页 `Project settings`**：`General`（Project Folder Name、Project path，均只读展示）、`Hardware`（Board、MCU）、`Software`（软件工程）、`IDE Project Generation`（General Setup：Format=CMake、CMake toolchain=GCC、Destination；Advanced：用户可修改组件、生成代码目录、Packs、安装目录、Automatic Conflict Handling Rules）、Packs 表、Global services 表；顶部 `Expand all/Split right/Quick menu`，底部 `Generate IDE project` | `CodegenDialog.vue` 是一个 640px 模态框：工程名 + 10 个生成项复选框 + 是否含 main.rs + 「仅导出配置/导出 ZIP/导出到文件夹」 | 工程级设置没有“家”；路径/工具链/目录/包/覆盖策略均缺失；生成入口是弹窗而非可反复查看的页 | **P0** | 新增 `ProjectSettingsView` 作为主标签页；先放 General/Generation/Advanced 三段；`CodegenDialog` 降级为“生成确认/结果”子流程 |
| 工程名/存放路径 | 创建工程时填 Project name + Project location，显示自动生成的完整 `.ioc2` 路径；Project settings 中可查看路径 | 只有 `projectName`（影响导出文件名）；导出目录每次临时选择，不持久化 | 工程没有“位置”概念，无法定位/重开/迁移 | **P0**（并入 P0-7） | 工程模型加 `projectPath`（桌面端真实目录，Web 端 IndexedDB/句柄）；最近工程与保存都用它 |
| 工具链/格式 | 实机 `Format: CMake`、`CMake toolchain: GCC`；工程设置还支持 build targets（`add-build-target`）与多编译器（GCC/IAR/AC6，见 ioc2 `csolution.yml`） | 固定 Cargo + rust toolchain；无 UI 选择（设计使然），但界面也未展示目标 triple/工具链版本 | 对 Rust 生态不算缺陷；缺“生成目标/工具链”可见性 | P2 | 在 Project settings 展示 target triple、rust toolchain、HAL rev（只读）；不引入 C 工具链选择 |
| 生成前 Check | 有错误/警告时弹 `Check configuration`：`Project contains configuration error(s)/warning(s)` + `Error(s)/Warning(s) found which could lead to non-functional generated code and/or hardware damage. You can review and fix the error(s)/warning(s) or continue.` 按钮 `Continue anyway` / `Cancel` | `errorCount>0` 时直接禁用导出按钮并显示红色 Alert；无“逐项查看/仍然继续”；warning 不阻断 | 我们更严格，但缺“检查报告 + 逐项定位 + 用户决策” | P1 | 生成前统一 `preflight()`：返回 errors/warnings；弹层列出可点击定位的条目；允许“我已知晓，继续”（仅 warning/可豁免项） |
| 再生成保护 | 导出前若有用户改动：`File changes summary` 表格（File name/Category/Option/Path），逐文件选 `Don't generate/Remove/Overwrite with backup/Overwrite without backup/Create base file for later merge`；类别级规则（All/User files/Project files/Pack/User modifiable/Generated）可设 `Show conflicting files/Don't generate/Backup/Overwrite`；默认 user_code 等为 `DIFF` | 目录导出直接按路径 `createWritable` 覆盖；仅 `src/main.rs` 由生成器保证不覆盖；无变更检测、无备份、无逐文件选择 | 再生成时用户改动（若不在 main.rs）无提示；无法备份/跳过 | P1 | 导出到已存在目录前做快照 diff（已有 `lastExportSnapshot` 可复用/扩展为磁盘哈希）；先实现“覆盖前摘要 + 备份”最小闭环 |
| 生成报告 | 生成输出到 `Code Generation Debug` Output 通道：逐 SW Project `Running code generation for SW Project: ...`，结束 `Code generation completed`；`showExportCompletionMessage` 展示完成消息（具体按钮未实机验证，推测含打开位置/关闭） | 成功后 toast `已导出 N 个文件（...）`；无日志、无逐文件报告、无“打开所在目录” | 出问题无法排查；成功也没有可回看的记录 | P1 | 增加生成结果面板（文件列表/耗时/警告），toast 只做摘要；桌面端加“打开目录” |
| 保存/另存 | `Save Project` / `Save As`；状态栏 `Click to save` ↔ `Saved`；工程导出设置自动保存（debounce） | `Ctrl+S`/状态栏保存到 localStorage；`cube.json` 仅通过导出对话框下载；无另存为工程、无自动保存 | 工程文件不可“另存为”，无法多副本；关闭页面即丢（除 localStorage） | P1（另存/P1，自动保存/P2） | 桌面端用原生保存对话框写 `.cube.json`；增加 `Save As`；导出设置（目录/选项）单独持久化 |
| 多软件工程/多构建目标 | `Software` 段显示 SW Project；csolution 支持多个 build-types/target-types；H417 这类多核可分别配置 | 代码生成支持 H417 双核 workspace，但 UI 没有“核/子工程”视图与每核配置入口 | 多核能力有后端、无前端表达 | P2 | 在 Project settings 显示核列表；每核打开独立配置上下文 |

### 1.6 状态与反馈

| 能力 | CubeMX2 行为（实机/源码） | 我们现状 | 差距 | 优先级 | 实现要点 |
|---|---|---|---|---|---|
| 未保存标记 | 状态栏左侧 `Click to save` / `Saved`（实机点击保存后变 Saved）；标签页可有状态图标（源码 `TabStateService.updateState('error'/'ok')` 用于 Clock 页） | 状态栏 `Click to save`/`Saved`；活动标签 dirty 红点；无“每页脏/健康”区分 | 脏标记粒度只到“全局 + 当前标签” | P2 | `documents[]` 每项带 `dirty`；标签红点按各自 dirty；健康状态另用颜色/图标 |
| 问题分级 | error/warning 贯穿：引脚状态图标、PinTag、每外设 `Configuration warning/error` 告警（warning 可关闭）、Project 图标 badge（error 红点/warning 黄点）、标签页状态、生成前 Check | 全局 `errorCount/warningCount` 在状态栏；`ConflictsPanel` 分组；抽屉混合冲突与通知；无每页/每标签健康态 | 无法从导航层看出“哪个外设/哪一页有问题” | P1 | 冲突按 `peripheral/pins` 归属到文档页；标签显示 error/warning 点；Project 图标 badge |
| 状态栏 | 左 `Click to save/Saved`；右通知铃 + 未读数（实机为 pack 更新提示） | 左保存状态 + 错误/警告数 + 芯片信息 + 铃铛；铃铛抽屉混放 conflicts 与 notifications | 信息量更足，但“问题”和“通知”语义混淆 | P1 | 拆成 `Problems`（冲突，可定位）与 `Notifications`（历史 toast/更新）；铃铛只显示通知 |
| 通知中心 | 实机底部 Info 卡：`New versions of one or more component packs can be updated.` + `Show details` | 无更新检查；通知抽屉只列文本，无 action | 无可操作通知 | P2 | 通知模型加 `actions[]`（打开、忽略、详情）；桌面端更新检查后置 |
| Undo/Redo | Pinout 本地 undo/redo **被源码注释禁用**（等待全局 undo）；Clock 后端提供 undo/redo，但 1.1.1 工具栏未渲染按钮；全局 undo 未发现 | 仅 `usePinOverwrite` 的引脚覆盖单步撤回（Pinout 工具栏按钮），无 Ctrl+Z、无时钟/外设/批量撤销 | 两边都不完整；我们覆盖面更窄但至少可用 | P2 | 建全局命令栈（pin/clock/peripheral/settings），`Ctrl+Z/Ctrl+Shift+Z`；先在时钟与引脚生效 |
| 错误定位 | 点击告警/issue marker 定位到引脚/节点；Project 图标与标签状态提示范围；Check 弹窗可回到配置 | 冲突面板点击 `selectPin + setView('pinout')`；时钟问题点击定位节点；外设冲突只在卡片内 | 不能从问题直接跳到“外设参数/时钟节点/工程设置”的正确位置 | P1 | 冲突项携带 `target:{view,peripheral,section,pin,node}`；统一 `locate(target)` |
| 加载/空状态 | 外设有 spinner/skeleton；无选中显示 `No Peripheral Selected` 页；时钟 `No selection yet`；页面切换有轻量过渡 | 有 `EmptyState`/`empty-detail`；生成时按钮 loading；无骨架屏 | 基本够用，缺长列表骨架与生成进度 | P2 | 列表/表格加载骨架；生成为长任务时显示进度/取消 |

### 1.7 辅助功能

| 能力 | CubeMX2 行为（实机/源码） | 我们现状 | 差距 | 优先级 | 实现要点 |
|---|---|---|---|---|---|
| 全局快捷键 | `Ctrl+S` 保存、`Ctrl+Q` 退出、`Ctrl+Tab`/`Ctrl+Shift+Tab` 切标签、`Ctrl+Alt+P` 关标签、`Ctrl++/Ctrl+-` 缩放、`Ctrl+Alt+K` 重置缩放、`Ctrl+Shift+U` Output（View 菜单实机） | 仅 `Ctrl+S` 保存、`?` 开关快捷键面板；Esc 只在帮助里写了但未实现 | 快捷键体系几乎空白 | P1 | 统一 `useHotkeys`；先接 Ctrl+S/Tab 切换/Ctrl+W 关标签/Esc 取消选择；与菜单命令共用 |
| 快捷键帮助 | Pinout 与 Clock 各有 `Shortcuts` 浮层，按 Move/pan、Scroll、Zoom、Select、Other 分组，内容随视图变化 | 一个全局对话框，3 条（其中 Esc 无效） | 帮助与上下文脱节且不准确 | P2 | 每视图注册 `shortcuts[]`，`?` 打开当前视图的面板；删除未实现项 |
| 文档链接 | 每个视图头 `Open STM32 documentation`；Help → Documentation 子菜单（MX2 online、Embedded Software、STM32 doc library）；Help → STM32 Packs & Licenses；Issue Reporter | Pinout/Peripherals 都硬编码 `https://www.wch.cn/products/CH32V003.html`（**换芯片后仍是 V003**）；About 无版本/文档链接 | 文档入口错误（对 V203/H417/CH582 全部错），Help 菜单不完整 | P1（错误链接建议立即修） | `chip.json` 增加 `docUrl/datasheetUrl/referenceUrl`；页头/Help/About 统一读取；补 WCH 文档/社区链接 |
| 导出/打印 | `Export pinout` CSV（含/不含 AF）；未发现打印或图片导出入口 | CSV 导出；无打印/PNG/SVG | 基本对齐；MX2 也无图片导出 | P2 | 保留 CSV；如需图片，用 SVG 序列化导出 PNG（现有原生 SVG 易做） |
| 主题/缩放 | Preferences → Theme Color；View → Zoom In/Out/Reset（Electron 页级缩放） | 无主题切换；无页级缩放 | 视觉偏好缺失 | P2 | 先加主题 token 切换（Element Plus 变量）；页级缩放可用 CSS zoom |
| 偏好持久化 | 实机 `settings.json` 保存：detail 面板宽度、legend 展开、pinout 表格分页/列/排序、toolbar 锁定/折叠、clock 属性面板可见性 | 无 UI 偏好持久化；面板宽度/折叠/表格状态刷新即丢 | 每次打开都要重设 | P2 | 建 `uiPreferences`（localStorage），按视图 key 存宽度/折叠/列/分页 |
| 无障碍/键盘可达 | 引脚支持 Tab/Enter/Escape 焦点操作；大量 `data-testid`/aria；菜单/对话框有角色 | 画布是 SVG `g` 点击，无 tabindex/role；按钮有 aria-label；对话框用 Element Plus | 键盘/读屏用户无法操作画布 | P2 | 引脚 `tabindex=0` + `role=button` + `aria-label`；焦点环；Enter/Space 触发选择 |

---

## 2. P0 清单（最影响日常使用）

1. **主视图与对象标签页**：Peripherals 实例独立标签页 + `Project settings` 主视图；替换“全实例卡片流 + 导出弹窗”。
2. **统一引脚搜索**：搜索类型（Pin/Signal/Label/Position）+ 建议/匹配导航，图形与表格共用同一过滤条件。
3. **Show 状态过滤**：Configured/Reserved/Unassigned/Not configurable/Pinned/Excluded/Error/Warning 九态 + 实时计数，替换当前无作用的 `showFilter`。
4. **引脚右键菜单**：Assign signal（分组）、Move signal、Configure peripheral、Edit label、Exclude pin、Reset Pin State。
5. **引脚状态模型/图例/徽标**：Configured/Reserved/Pinned/Excluded/Error/Warning 在图形、表格、详情、悬停一致呈现。
6. **外设 Mode 选择 + Activate 流程 + 单外设工作区**：先选 mode 再激活；参数区随 mode 变化；Deactivate 有确认。
7. **Project Manager 主视图**：工程名/路径、格式/工具链、导出目的地、覆盖策略集中管理，`Generate IDE project` 成为页内动作。
8. **真实工程菜单与最近工程**：Project 下拉（新建 MCU/Board、打开、最近、Save/Save As、关闭、偏好）+ Home 最近工程卡，替代伪菜单与单快照。

## 3. P1 清单

1. 引脚拖拽移动信号 + alternate pins 预览。
2. 信号列表弹窗（搜索/分组/多信号/pinned/Reserved↔Configured）。
3. 引脚详情全量（All-pins `Sort by`、Pin characteristics、Pin state、图例、多 label）。
4. 引脚表格升级（Used only、Columns、分页、行内 Assign、Status、Actions）。
5. 外设树 9 分类 + `Filter by` 排序 + `Show All/Active/Inactive`。
6. 外设参数分层（section/subsection/help/software label/生成策略）+ Quick menu 章节导航。
7. 时钟节点内联编辑（select/radio/单位切换）。
8. 时钟节点锁定/解锁、路径高亮、`Configure RCC`。
9. `Resolve clock issues` 自动修复 + 时钟表格可编辑。
10. 生成前 `Check configuration` 报告 + 逐项定位 + 用户决策（Continue anyway）。
11. 再生成 `File changes summary`：逐文件动作（跳过/备份/覆盖/移除）+ 类别级规则。
12. 生成报告面板（逐文件/耗时/警告）与“打开所在目录”。
13. 每标签页健康状态（error/warning）、Problems 与 Notifications 分离、警告可关闭。
14. 真实快捷键（Ctrl+Tab/Ctrl+Shift+Tab/Ctrl+W 或 Ctrl+Alt+P、Esc、Ctrl+±、Ctrl+Alt+K）。
15. 文档链接按芯片（`chip.json` 的 docUrl），Help 菜单补文档子菜单/Issue Reporter。
16. NVIC（及后续 DMA）配置 UI：IRQ/优先级/使能表。
17. 定时器/PWM 等实例的真实参数配置（替代 Display-only）。

## 4. P2 清单

1. 标签分屏（left/right/up/down）与标签拖放。
2. 封装交互增强：90° 旋转、Bottom 翻转、引脚细节尺寸按钮、工具栏锁定/自动收起。
3. 悬停浮卡增强（状态/图例/操作提示）与画布键盘导航/无障碍。
4. `Export pinout` 的“含/不含 AF”二选一菜单。
5. 通知中心（pack/版本更新，带 Show details 动作）。
6. 主题切换、页级缩放、UI 偏好持久化（面板宽/折叠/列/分页）。
7. 自动保存与“另存为工程文件”的完整体验。
8. 全局 Undo/Redo（覆盖引脚/时钟/外设/设置）。
9. Middlewares & Utilities、Parts、Pack manager 视图（与 Rust/ch32-hal 生态差异大，按需引入）。
10. 多核/多构建目标的 UI 表达（H417 双核已有后端，无前端入口）。
11. 打印/图片导出（MX2 1.1.1 未发现打印入口，非紧迫）。

---

### 附：优先级判定说明

- **P0**：缺失后“日常配置主流程”必须绕路或无法完成（找不到对象页、选不了状态、改不了信号、生成入口不成体系）。
- **P1**：明显拖慢高频操作或造成理解/定位成本（搜索/表格/参数层级/时钟修复/生成报告/文档）。
- **P2**：体验增强、生态视图或低频操作（分屏、主题、打印、Undo、Middleware/Parts/Pack）。
- 与生成器强相关的字段/文件组/迁移机制不在此报告重复；见 `docs/ANALYSIS-MX2-CODEGEN-GAP.md`。