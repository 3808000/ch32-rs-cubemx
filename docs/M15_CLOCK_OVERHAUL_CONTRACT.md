# M15 时钟树配置页大修契约（MX2 对齐 + 外设时钟配置）

> 立项：2026-11-18（用户指令「大修时钟树配置页面，参考 CUBEMX2，增加对 IIC/SPI 等外设单独时钟配置」）。
> 真相源：`reference/ch32-hal`、`reference/ch32-data`、`reference/ch32-metapac`、`reference/ch58x-hal`（= /tmp/m14-ble/fw-ship/vendor/ch58x-hal）、ch58x PAC 0.4.0（cargo registry）。
> MX2 基准：`/home/teze/CH32/CubeMX/reference/mx2-ui/03-clock-tree.png` + `ANALYSIS-MX2-GAP.md:77-90`（STM32C542 实机 CDP 记录）。
> 前置契约继续有效：CH58X_BACKEND_CONTRACT（D3 时钟生成）、M14_CHIP_INTAKE_CONTRACT（D3/D4 时钟模型扩展）。

## 0. 硬件真相（诚实边界根基，Explore 三代理 PAC/HAL 逐字核实）

- **WCH 芯片 I2C/SPI/USART 无独立内核时钟 mux**：固定 PCLK1/PCLK2/HCLK。ch32-hal `build.rs:351-357` `T::frequency()`=**bus_clock**；`rcc/v3.rs:99` 的 `mux` 字段被上游注释掉。ch32-data `rcc.kernel_clock` 无 Mux 实例（metapac `Mux` 变体零使用）。→ **不发明 mux**；外设节点源为固定总线 + `fixed` 徽标。
- 真实旋钮：① 速率参数（SPI `frequency`→BRG、I2C `speed`→CCR、USART `baudrate`→BRR；HAL 静默回退/钳位）② ADC 分频链 ③ USB 48M 域（HAL 自动 USBPRE，无 API）。
- ADC：V003/V103 RCC ADCPRE ÷2/4/6/8 存在但 **HAL 无 API**（`adc.rs:66-69` cfg 排除 adc_v003/adc_v1）；V203/V307/X035 **HAL 写 CTLR3.CLK_DIV**（`adc.rs:68` cfg(adc_v3,adc_x0)，`Config.clkdiv` raw，缺省 0b11）；V203/V307 另有 ADCPRE（HAL 不写）；H417 `Config.bus.adcpre` 有 API 但本芯片 preset_only → 本期仅显示；CH582 `SamplingClock` 枚举（`adc.rs:8-37`）已生成。
- USB：V103 `calc_usbpre`（v1.rs:311-318）仅 48→÷1 / 72→÷1.5；V203/V307（v3.rs:487-497）48→÷1 / 96→÷2 / 144→÷3（240→÷5 仅 d8w）；**其余 PLL 输出静默留复位值 → USB 时钟非法且无警告**（V103 80MHz 预设中招）。X035 HSI 48M 直连。V103/V203 该 USB layout 无 HAL 驱动；V307 OTG_FS 有。
- H417 是唯一有 `KernelMux` API 的芯片（rcc/h4/mux.rs）但 preset_only + I2S/RNG/LTDC 等多数无驱动 → **本期不建模**（note 说明）。
- 公式逐字核实落点（实现时必读）：ch32 `spi.rs:833-853 calculate_baud_rate`（2 的幂，请求>bus/2→DIV_2，<bus/256→DIV_256）、`usart/mod.rs:1093-1100`（BRR）、`i2c.rs:258+ timing()`（assert ≤400k；standard ccr=bus/(2f)、fast Duty2 ccr=bus/(3f)、Duty16 ccr=bus/(25f)）；ch58x `spi.rs:169-177`（fdiv=sysclk/freq 整除 clamp 2..255）、`uart.rs:360-371`（DIV=1、DL=round(Fsys/(8*baud))，actual=Fsys/(8*DL)）。

## D1 数据驱动：clock.json `peripheralClocks` 块（类型已落 src/model/types/clock.ts）

schema 见 types（PeripheralClocksData/UsartClockSpec/SpiClockSpec/I2cClockSpec/AdcClockSpec/UsbClockSpec）。**7 芯片数据块（A 域照此落 JSON，源总线以 ch32-data bus_clock 逐字复核）**：

- **V003**：usart{HCLK,baudrate}；spi{HCLK,frequency,brg.divs=[2,4,8,16,32,64,128,256]}；i2c{APB1,speed,maxKhz:400}；adc{source:APB2, pre{programmable:false, note:'ADCPRE 上游 FIXME（v003.rs:20,125），HAL 不写，复位 ÷2 不建模'}}；无 usb。
- **V103**：usart{APB1,overrides{USART1:APB2},baudrate}；spi{APB1,overrides{SPI1:APB2},frequency,brg.divs 同 V003}；i2c{APB1,speed,400}；adc{APB2, pre{false,'ADCPRE 存在但 HAL 无 API（复位 ÷2）'}}；usb{autoPre{'48':1,'72':1.5}, validPllMhz[48,72], note:'HAL calc_usbpre 自动、无 API；该 USB layout 无 HAL 驱动'}。
- **V203**：usart{APB1,overrides{USART1:APB2}}；spi{APB1,overrides{SPI1:APB2}}；i2c{APB1}；adc{APB2, pre{false,'ADCPRE HAL 不写'}, clkDiv{programmable:true,bits:4,default:3,raw:true,note:'CTLR3.CLK_DIV raw 语义待核实；HAL 缺省 0b11'}}；usb{autoPre{'48':1,'96':2,'144':3}, validPllMhz[48,96,144], note:'自动、无 API、无驱动'}。
- **V307**：同 V203（usart1/spi1 挂 APB2；adc clkDiv 同；usb note 加 'USBHS hspll API 存在但 USBHS 外设本期不建模'）。
- **X035**：usart/spi/i2c 全 {HCLK}；adc{source:SYSCLK, clkDiv{true,4,3,true,note:'div:8 系 HAL 注释假设（0b11），PAC 仅 4-bit raw'}}；usb{autoPre{}, validPllMhz[], fixedMhz:48, note:'HSI 48M 直连无分频'}。
- **H417**：usart{APB1,overrides{USART1:APB2}}；spi{APB1,overrides{SPI1:APB2}}；i2c{APB1}；adc{APB2, pre{false,'HAL 有 adcpre API 但本芯片 preset_only；adcsrc/duty 不写'}}；无 usb（notes 加 'KernelMux（i2s/usbfs/rng/ltdc/uhsif/eth1g/hsadc）HAL 有 API 但多数外设无驱动 + preset_only，本期不建模'）。
- **CH582M**：usart{HCLK,baudrate}；spi{HCLK,frequency,brg.linear{min:2,max:255}}；i2c{HCLK,frequency,400}；adc{source:CK32M, fixedInMhz:32, knob:'samplingClock', enumMhz{'_3_2MHz':3.2,'_5_33MHz':5.33,'_4MHz':4,'_8MHz':8}, note:'0b01 HAL 标 8MHz / PAC 标 2.67MHz 未裁决；旋钮镜像外设参数'}；无 usb。**clock.json.adc 占位（SYS/APB2/div1）替换为 CK32M 真实模型**：options=[{id:'CK32M',label:'CK32M ÷ SamplingClock',source:'CK32M',div:1}]（div 语义由 samplingClock 枚举承担，computeClock 的 adcMhz 对 CK32M 源=fixedInMhz=32，再经枚举 MHz 显示于 P-ADC 节点）。

**D8 诚实修复**：V003 peripherals.json SPI `bitOrder` 移除 `LsbFirst`（spi_v0 仅 MSB，spi.rs:65-70；现状选中即编译错误）；V003 adc 保持 div:1 + note（不改频率宣称）。

## D2 模型扩展（A 域）

- `model/clock/peripheral.ts` 新（纯函数）：
  - `computePeripheralClocks(spec, cfg, freqs, periData: PeripheralsData, periState: Record<string, PeripheralState>): PeripheralClockFreq[]`——遍历 periData 的 usart/spi/i2c/adc 实例（**含未启用实例**：树上显示全部实例，未启用节点 active=false、requested 取参数缺省）；USB 域节点单独追加。公式按 §0 逐字复刻（ch32/ch58x 分流按 spec.chip？**禁止 chip 硬编码**——用数据特征分流：spi.brg.linear 存在=ch58x 线性；adc.knob 存在=枚举镜像；其余 ch32 公式）。
  - `validatePeripheralClocks(...)` 产出 ClockIssue[]（node=nodeId）：SPI requested>bus/2 → warning「请求超 bus/2，HAL 将用 DIV_2，实际 X MHz」；requested<bus/256 → warning DIV_256 回退；I2C >maxKhz → error；USART |errorPct|>baudErrorWarnPct(缺省3) → warning；USB PLL 不在 validPllMhz（无 fixedMhz 时）→ warning「PLL X MHz 不在 USBPRE 合法集，USB 时钟非法（HAL 静默留复位值）」；ADC 超 maxMhz 沿用既有 validateClock warning（不重复）。
  - `applyPeripheralClockControl(state: PeripheralState, control: ClockNodeControl, value): PeripheralState` 放 **tree/model.ts（B 域）**——params 合并写回。
- `index.ts`：`mergeClockConfig` 补 adcClkDiv 缺省（spec.peripheralClocks?.adc?.clkDiv?.default，仅 programmable）；`presetToConfig`/`applyClockPreset`：adcClkDiv 重置缺省除非 ADC 锁定（同 adc 语义）；`matchPreset` **不比较** adcClkDiv（同 adc）；`isClockNodeLockable` 不变（ADC 已锁域覆盖 adcClkDiv）；solvePll/resolveClockIssues/countConfigChanges **不纳入** adcClkDiv。
- `computeClock`：adc 源新增 'CK32M' 分支 → fixedInMhz（spec.peripheralClocks.adc.fixedInMhz ?? 32）。ClockFrequencies 形状不变。

## D3 树模型/布局泛化（B 域）——接口形状冻结（C 域照此消费）

`tree/model.ts`：
```ts
// ClockNodeControl.field union 扩：'adcClkDiv' | 'periParam'
//   periParam 时：periId + paramKey 必填；options 取自 ParamSpec（number→string label 原生单位）
// ClockNodeModel 增（全部可选除 column/group）：
//   column: number   // 0 sources 1 PLL 2 system(SYSCLK/AHB) 3 buses(APB1/2) 4 TIM 5 USART 6 SPI 7 I2C 8 ADC 9 USB
//   group: string    // 既有 g-sources/g-pll/g-sys/g-tim/g-adc + 新 g-usart/g-spi/g-i2c/g-usb
//   badge?: 'fixed' | 'derived' | 'raw'
//   periId?: string
//   issues?: ClockIssue[]      // hover tooltip 全量消息
//   requestedLabel?: string    // 外设节点：请求值原生单位（'115200 baud'/'8 MHz'/'raw 3'）
//   actualLabel?: string       // 外设节点：实际派生（'实际 7.5 MHz (÷8 BRG)'/'误差 0.16%'）
export interface PeripheralClockContext {
  peripherals: PeripheralsData
  state: Record<string, PeripheralState>
  periFreqs: PeripheralClockFreq[]
}
// buildClockModel(spec, cfg, freqs, issues?, peri?: PeripheralClockContext)
// CONTROL_NODE 增 adcClkDiv:'ADC'；periParam 不入 CONTROL_NODE（外设节点 lockable=false）
// applyClockControl 增 case 'adcClkDiv'（Number + control.min/max clamp）；periParam 返回原 cfg（视图层路由）
```
- 外设节点构成：每实例一节点 id='P-'+iid，label=iid；control：usart/spi/i2c → periParam（kind 按 ParamSpec：number→number、options→select）；adc 实例 → clkDiv.programmable ? {field:'adcClkDiv', kind:'select', options:0..2^bits-1 label 'raw N (0bBBBB)'} : knob ? periParam(samplingClock) : null（仅显示徽标）；badge：源固定='fixed'，adc raw='raw'，USB='derived'。inMhz/outMhz：outMhz=actualMhz（raw=null）；maxMhz：spi=bus/2、i2c=maxKhz/1000、usart=null、adc=spec.adc.maxMhz。active：实例 enabled 或时钟域节点；未启用实例 active=false 但仍渲染（dim）。
- 边：bus 节点→外设节点（sourceBus 映射 APB1→APB1 节点等；HCLK→AHB 节点；CK32M→ADC 域节点）；ADC 域节点→P-ADCx（同列垂直边）；PLL→USB。
- `tree/layout.ts`：**列式自动布局**——x=40+column*200；列内按模型顺序堆叠 y=60+i*140（列首对齐源列中点可选）；group box=成员包围盒+PAD30；**删除 posById 硬编码**；通用正交走线：跨列=右中→midX 折弯→左中（同走廊多边 offset 12px 错开）；同列=底中→顶中垂直。**验收判据：走线点集不穿过任何节点卡矩形**（测试断言代表性芯片）。buildClockTree(spec,cfg,freqs,issues?,peri?) 透传。
- 既有 19 个 clockTree 测试按新几何更新（核心节点相对关系保持：源左→PLL→SYSCLK→AHB→APB→TIM/ADC）。

## D4 写回路由 + UI（C 域）

- ClockView.onControlChange：control.field==='periParam' → `store.setPeripheral(control.periId!, {...cur, params:{...cur.params,[control.paramKey!]:v}})`；否则既有 applyClockControl 路径。periCtx 组装：`{peripherals: store.deviceData.peripherals, state: store.peripherals, periFreqs: computePeripheralClocks(...)}`；issues 合并 validateClock+validatePeripheralClocks。
- ClockNode：issue marker（右上小圆点 error 红/warning 橙）+ `<title>` hover 全量消息；badge 徽标（fixed/derived/raw 小标签）；源选择类控件（field source/pllSource/adc 且 options≤4）渲染 **radio 组**（foreignObject）；分频控件（ahb/apb1/apb2/pll/adcClkDiv）渲染 **stepper**（- 值 +，options 索引±1，锁定/fixed 置灰）；requestedLabel/actualLabel 双行显示于外设节点。
- ClockWire：按 target 节点 issueLevel 着色（error 红/warning 橙/active 蓝/inactive 灰）。
- ClockCanvas：点状背景（CSS radial-gradient）；抓手模式按钮+Space 临时抓手；方向键滚动（扩 common/canvasNav.ts）；路径高亮 prop（highlightIds:Set）dim 非高亮。
- ClockView：表格 Value 列可编辑（复用 inlineEdit.ts + 同路由）+ Actions 锁列（外设行锁禁用）；Reset 确认（新 common/ConfirmDialog.vue：el-dialog + 「不再询问」checkbox → uiPreferences `clock.resetConfirmSkip`）；右键菜单（新 clock/ClockContextMenu.vue 仿 pinout/PinContextMenu.vue：Lock/Unlock、Highlight source path、Highlight all paths、Clear highlight、Configure 外设→peripheralFocus 桥）；路径高亮 BFS（上游 ancestors/下游 descendants，edges 双向遍历）+ 工具栏 Clear 按钮；Shortcuts 浮层（静态分组列表：Move/pan/Scroll/Zoom/Select/Other）。
- peripheralFocus 桥：新 components/peripherals/peripheralFocus.ts 仿 clock/clockFocus.ts（request/take）；PeripheralsView 挂载 take→openPeripheral(iid)（既有 QuickMenu select 路径）。
- ClockDetail：能力判断改节点元数据驱动（control.field/badge/periId 而非 ID 硬编码表）；外设节点详情：源总线/输入/请求/实际/分频/误差 + 「在外设视图配置」跳转按钮；保留预设/目标解算/问题列表（差异化能力）。
- uiPreferences 新键：clock.resetConfirmSkip、clock.handMode?（会话态不入偏好）、clock.shortcutsVisible?（不入）。

## D5 代码生成（D 域，仅真实 API）

- ch32 `adc.ts` + `templates/adcRs.ts`：spec.peripheralClocks?.adc?.clkDiv?.programmable 且 cfg.adcClkDiv !== undefined 且 ≠default？——**设置即发射**（含等于 default 也发射显式值？否：等于 default 走 Default 保持快照不变；≠default 发射 `hal::adc::Config { clkdiv: N, ..Default::default() }`）。V203/V307/X035 生效；H417/v4x7 路径不动（Result 签名不同）。
- 单核 README（ch32 templates/readme.ts）补「时钟摘要」节：SYSCLK/HCLK/PCLK1/PCLK2/ADC MHz + 命中预设名（computeClock+matchPreset；gap P1）。ch58x README 已有摘要不动。
- ch58x 生成零变化；**不发明 RCC/mux/USB 字段**。
- 快照审查：仅 adc（设 clkdiv 用例）+ README 变化；其余逐字节不变。
- 取证：V203 设 adcClkDiv=5 生成工程真实 cargo build 一次（隔离 HOME + CH32_HAL_DIR=reference/ch32-hal）。

## D6 校验脚本（A 域）

validate-device-data.mjs 增 peripheralClocks 结构校验：sourceDefault/overrides 值 ∈ PeripheralClockBus；knob 存在于对应类别 peripherals.json 实例 params；spi brg divs 非空或 linear min<max；i2c maxKhz>0；adc clkDiv default ∈ [0,2^bits)；usb autoPre 键 ∈ validPllMhz（fixedMhz 除外）；enumMhz 键 ⊆ knob ParamSpec options。预设复现校验不变。

## D7 边界（诚实标注进 README/报告/契约）

H417 KernelMux 不建模；USB 仅显示+警告无生成；adcClkDiv 全局单值（多 ADC 实例同值）；raw 语义未核实芯片 UI 警告+不编造 MHz；外设节点不可锁（MX2 全节点锁的差异）；单位切换不做；非预设 PLL 显式导出仍暂缓（M16 候选）；分屏/全局 undo 不在本期。

## D8 文件域（排他）

- **主控先行（已完成）**：types/clock.ts 扩展、本契约。
- **A**：model/clock/peripheral.ts 新、model/clock/index.ts、data/devices/*/clock.json（7）、data/devices/ch32v003f4p6/peripherals.json（bitOrder）、scripts/validate-device-data.mjs、tests/peripheralClock.test.ts 新、tests/ch58xData.test.ts 等数据测试更新。
- **B**：model/clock/tree/model.ts、tree/layout.ts、tests/clockTree.test.ts、tests/clockLock.test.ts（如涉及）。
- **C**：components/clock/{ClockNode,ClockWire,ClockContextMenu}.vue、components/ClockCanvas.vue、components/ClockDetail.vue、views/ClockView.vue、components/common/ConfirmDialog.vue、components/common/canvasNav.ts、components/clock/clockFocus.ts（不动）+ components/peripherals/peripheralFocus.ts 新、views/PeripheralsView.vue（take 挂载）、services/uiPreferences.ts。
- **D**：model/codegen/adc.ts、model/codegen/templates/adcRs.ts、model/codegen/templates/readme.ts（ch32 单核）、tests/codegen.test.ts + 快照、verify 取证 build。
- **主控收尾**：集成、门禁、浏览器验收、HAL notes §15、ROADMAP M15、PROJECT_MEMORY、docs/images/clock.png、推送。

## D9 门禁

1331+ 测试全绿（新增约 +70：peripheralClock ~30 / clockTree 泛化 ~20 / codegen adc+README ~10 / validate ~10）；vue-tsc/eslint/validate 7 芯片 0/0/vite build；verify:build blocking 6/6 + embassy 6/6 + BLE 1/1；浏览器验收五芯片（V003/V203/V307/X035/CH582M）：外设节点渲染+SPI 超 bus/2 警告+ADC raw 旋钮→Code preview clkdiv+表格编辑+Reset 确认+路径高亮+右键跳外设；V203 adcClkDiv=5 ZIP cargo build；推送远端对齐。