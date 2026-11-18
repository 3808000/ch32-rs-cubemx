# M16 时钟树逐芯片重画契约（RM 框图保真 + MX2 分离图元 + 缺失域仅显示补全）

> 立项 2026-11-18：用户裁决 M15 树「太丑、配置项挤在一起」，要求参照芯片 RM 时钟树框图 + CubeMX2 布局逐芯片重画；缺失域一并补（仅显示不生成）。
> 真相源：RM 转录 docs/m16-rm/*.md（R1/R2 子代理产出，含页码）；MX2 基准 reference/mx2-ui/03-clock-tree.png；HAL reference/ch32-hal、reference/ch58x-hal。
> 前置：M15_CLOCK_OVERHAUL_CONTRACT（逻辑节点/写回路由/periFreqs 继续有效）。

## D1 图元语言（MX2 照抄，簇内分离块）

`ClockNodeKind = 'osc'|'mux'|'div'|'readout'|'peri'|'pll'`（types/clock.ts 已落）。**逻辑节点数组不变**（表格/Detail/菜单/聚焦/高亮/锁定零改动）；kind 决定渲染簇：

| kind | 簇构成（左→右） | 默认尺寸常量（layout.ts export PRIM，渲染共用） |
|---|---|---|
| osc | 标题行 + 值格（HSE 可编辑 number+单位） | OSC_W=96, OSC_H=44 |
| mux | mux 竖块（输入小 label+radio 点列，选中实心蓝/未选空心灰/仅显示灰置灰）+ 读数卡（N MHz / max N MHz 两行） | MUX_W=84, MUX_ROW=16, MUX_PAD=12, READOUT_W=104, READOUT_H=44, CLUSTER_GAP=12 |
| div | stepper 块（- N +）+ 读数卡 | DIV_W=96, DIV_H=44 |
| pll | mux(pllSource) + 参数 stepper 链（prediv/mul/div 横排）+ 读数卡 | STEP_W=72, STEP_H=32 |
| readout | 单读数卡（N MHz / max N MHz；可带 hint 行如 ×2 / USBPRE ÷3 auto） | READOUT_W=104, READOUT_H=44（hint 时 +16） |
| peri | 单 airy 卡：标题+徽标行 / 旋钮行(30px) / 请求行 / 实际行（行距 ≥20px） | PERI_W=190, PERI_H=96 |

行距硬约束：读数两行基线差 ≥18px；peri 行距 ≥20px；标题与控件间隔 ≥14px（M15 拥挤点归零）。簇内块间 1px 连接线。**白纸面板**替换点阵背景（MX2 实机为纯白纸+细边框）；分组框 11px 左上标题、淡描边。

## D2 锚点与走线（layout.ts）

- osc：out=右中；mux/pll：in=**mux 左缘第 i 行 y**（i=edge.from 在输入列表索引；输入列表=control.options 顺序 + displayOnly 源追加灰行），out=读数卡右中；div：in=stepper 左中，out=读数卡右中；readout/peri：in=左中、out=右中。
- 边 from/to 逻辑 id 不变；正交折线+走廊错开（M15 机制保留），lanes hint 优先；**走线不穿任何簇矩形**（测试断言，含 aux）。
- 簇矩形=node.x/y/w/h（layout 按 kind 算 w/h）；diagram 坐标=簇左上。

## D3 逐芯片布局数据（clock.json.diagram，types 已落）

`{ nodes: {<id>:{x,y,kind?}}, groups?: [{id,label,x,y,w,h}], lanes?: {<edgeId>:n} }`。五区带镜像 RM：源区 / PLL 簇 / 系统区(mux+SYSCLK+HPRE) / 分频区(APB+TIM) / 外设簇区(USART/SPI/I2C/ADC/USB 列) + aux 域就近 RM 位置（RTC/MCO 靠源区或独立小簇）。有 diagram 用之；无→M15 列式回退。validate 5c：nodes 全覆盖（逻辑+aux）、坐标非负、分组框覆盖成员且互不重叠、走线不穿块。

## D4 缺失域仅显示（clock.json.aux + sources.displayOnly，types 已落）

- aux 节点：badge='derived'、**displayOnly=true**（灰渲染）、lockable=false、control=null、issueLevel=null、active=true；inMhz/outMhz=fixedMhz??null；hint=note；边 inputs→aux **active=false**（灰）。
- displayOnly 源：osc 灰块；**不进 SYSCLK/PLL control options**；src→sys/pll 边 active=false；mux 灰行追加渲染。
- **codegen 零改动**；aux/displayOnly 不进 ClockConfig/cube.json/solver/matchPreset/validateClock。README 时钟摘要增「仅显示域（不生成）」列表+note。
- 逐芯片 aux 内容（G 域照此+RM 转录细化；note 逐字诚实）：
  - **V003**：sources+LSI{freqMhz:0.128,displayOnly}；aux: IWDG{kind:readout,label:'IWDG',inputs:[LSI],fixedMhz:0.128,note:'LSI 128kHz 独立域'}、MCO{kind:mux,label:'MCO (PC4)',inputs:[SYSCLK,HSI,HSE,PLL÷2 按 metapac Mco 枚举],fixedDivLabel:'÷1',note:'HAL mco.rs 有驱动但本期不生成'}、ADCPRE{kind:div,label:'ADCPRE',inputs:[APB2],fixedDivLabel:'÷2(复位)',note:'HAL 无 API；上游 FIXME v003.rs:20,125'}。
  - **V103**：sources+LSI0.04+LSE0.032768(displayOnly)；aux: RTC{kind:mux,inputs:[LSE,LSI,HSE÷128? 按 HAL RtcClockSource],note:'LsConfig::init=todo!() 不生成'}、MCO{kind:mux,label:'MCO (PA8)',inputs:[SYSCLK,HSI,HSE,PLL÷2],fixedDivLabel:'÷1',note 同 V003}、USBPRE{kind:div,label:'USBPRE',inputs:[PLL],fixedDivLabel:'auto ÷1/÷1.5',note:'HAL calc_usbpre 自动；48/72MHz 合法'}（USB 外设节点保留 M15）。
  - **V203**：同 V103（LSI 40k/LSE/RTC/MCO PA8/USBPRE auto 48/96/144）+ ADCPRE{kind:div,inputs:[APB2],fixedDivLabel:'÷2..÷8',note:'HAL 不写 ADCPRE；CTLR3.CLK_DIV 见 P-ADC raw 旋钮'}。
  - **V307**：同 V203 + PLL2{kind:pll,label:'PLL2',inputs:[HSE,HSI? RM],note:'HAL todo!() 不生成'}、PLL3{同}、USBHS{kind:pll,label:'USBHS PLL',inputs:[HSI,HSE],fixedDivLabel:'pre ÷1..8',note:'hspll API 存在但 USBHS 外设未建模'}、MCO PA8。**I2S mux 不画（无驱动）**。
  - **X035**：sources+LSI{displayOnly}；aux: IWDG{readout,inputs LSI}、WWDG{readout,inputs:[APB1],note:'PCLK1 域'}、MCO{kind:mux,label:'MCO (PB9)',inputs:[SYSCLK,HSI,...RM],fixedDivLabel:'÷1',note 不生成}。
  - **H417**：sources+LSI/LSE(displayOnly)；aux: RTC{mux,inputs LSE/LSI,note:'BDCTLR.RTCEN 门控；不生成'}、MCO{mux,label:'MCO (PB0)',inputs RM,fixedDivLabel:'÷1',note 不生成}、V5F{kind:readout,label:'V5F core',inputs:[SYSCLK],fixedMhz:null→派生 sysclk/1,note:'HPRE=1 固定；模型 ahb 为 HPRE×FPRE 合成'}、V3F{kind:readout,label:'V3F / HCLK',inputs:[AHB],note:'合成 ÷4 语义见 clock.json notes'}、USBHSPLL{kind:pll,note:'AuxPlls 不建模'}。**KernelMux 不建模（note）**。
  - **CH582**：sources+CK32K{freqMhz:0.032,displayOnly}+LSI/LSE?（CH582 32K 源=LSI/LSE 经 Clock32KSrc）→ sources+LSI0.032+LSE0.032768(displayOnly)；aux: CK32KSEL{kind:mux,label:'32K 源选择',inputs:[LSI,LSE],note:'sysctl Clock32KSrc；BLE 用 RTC 时基'}、RTC{kind:readout,label:'RTC / BLE 时基',inputs:[CK32KSEL],fixedMhz:0.032,note:'BLE 占用（M12）；不生成 RTC 配置'}；SYSCLK mux 灰行追加 CK32K（ClockSrc 三路，HSE 直连/CK32K 不可生成已有 error 边界）。
- H417 双核分叉用 V5F/V3F readout 表达（不改 ahb 合成语义）；V203 prediv 缺口保持暂缓（M17 候选）。

## D4bis R1 转录裁决更正（2026-11-18，docs/m16-rm/{v003,v103,x035}.md 逐字证据，G 域照此执行）

- **V003**：RM 图 3-2（印刷 p11）**ADCPRE 上游=HCLK**（非 APB2）、档 ÷2..÷128、复位 ÷2 → **结案 v003.rs:20,125 FIXME**：clock.json.adc 改 `{source:'AHB', div:2}`（adcMhz=12，M15 的 24 偏高 2× 纠正）+ aux ADCPRE{kind:div, inputs:[AHB], fixedDivLabel:'÷2(复位)', note:'RM 图 3-2：ADCPRE 自 HCLK；HAL 无 API 不写'}。**RM 图无 APB2 预分频器**：diagram 将 APB2 kind 覆盖为 readout + note「RM 图无 APB2 预分频；HAL PPRE2 写入属 undocumented（v003.rs FIXME），配置能力保留于 Detail/表格」；apb2.options 数据保留（HAL 真写寄存器）。**MCO 枚举无 PLL÷2**：aux MCO inputs=[SYSCLK,HSI,HSE,PLL]（note：图首行标 HSI 实接 SYSCLK）。无 LSE/RTC（不画）。
- **V103**：RM PLL **4 源**（HSI/HSI÷2/HSE÷2/HSE；HSI÷2 由 EXTEN_CTR.HSIPRE 控制不在 RCC）——配置真相仍 HSI/HSE+prediv（HAL Pllsrc 仅两值）；diagram pll 簇 hint/note「RM 另含 HSI÷2/HSE÷2 支路（HSIPRE/prediv），未建模支路不画假 mux 行」。**RTC inputs=[HSE÷128,LSE,LSI]**（补 HSE÷128 灰行：aux inputs id 须存在→用 displayOnly 源? HSE÷128 非源 osc：aux RTC inputs 用 {id:'HSE',label:'HSE÷128'} 复用 HSE 节点边+label 注明 ÷128）。HSE 范围 RM 4~16 vs DS 8~25 冲突：**保留 8~25**（DS 电特性表权威）+ clock.json notes 并列冲突。HCLK ÷512 RM 有/HAL 仅 ÷16：保留 HAL 边界 note。
- **X035**：**无 LSI**！IWDG/AWU=HSI÷1024≈46.875kHz → 不加 LSI displayOnly；aux IWDG{kind:readout, inputs:[HSI], fixedMhz:0.046875, note:'HSI÷1024（RM 图 3-2）'}、AWU{同}；MCO inputs 图行名 HSI/HCLK 但寄存器 100=SYSCLK/101=HSI → inputs=[SYSCLK,HSI] + note 编码差异。**ADC CLK_DIV 实为 9 位非自然编码**（ADC_CTLR3.CLK_DIV[8:0]，复位 0x3 不在编码表）→ P-ADC raw 旋钮 note 升级「9 位非自然编码，复位值不在表内，÷8 系 HAL 注释假设，语义未核实」（M15 raw 边界加强）。
- R2 转录（v203/v307/h417/ch582）落地后如有同类裁决，主控补 D4ter。

## D4ter R2 转录裁决（2026-11-18，docs/m16-rm/{v203,v307,h417,ch582}.md，G 域照此）

- **V203**（RM V2.5 图 3-3 d8，p26）：aux RTC 三源（LSE/LSI/HSE÷128，HSE÷128 用 {id:'HSE',label:'HSE÷128'}）；MCO inputs 加 SYSCLK（寄存器有、图只画 HSI/HSE/PLL÷2，note 并列）；RM 有 HSE÷2/HSI÷2 预分频支路（repo prediv 固定 1，**M17 候选**）→ pll 簇 note 不画假行；d8 图 I2S2/I2S3/TRNG 直连 SYSCLK（无驱动不画 mux，note）。
- **V307**（图 3-2 d8c，p25）：aux PLL2/PLL3{kind:pll, inputs 按转录, note:'HAL v3.rs todo!() 不生成'}、USBHS{kind:pll, label:'USBHS PLL', note:'pre ÷1..8 + ref 3/4/5/8M；hspll API 存在但外设未建模'}、MCO 7 源按转录、RTC 三源；ETH125M/I2S2/3SRC/RNG **不画**（无驱动/未建模 note）；AHB 硬件 9 档 repo 仅 5 档 note（HAL 边界保留）。
- **H417**（RM V1.8 图 3-2，p12）：**RM 只有 PPRE2 无 PPRE1** → APB1 kind 覆盖 readout + note；定时器内核=PCLK **无 ×2** → TIM readout note（repo timerClock 缺省 apb_x2 但 APB≡1 数值等价，note 说明）；RTC 第三源 **HSE÷512**（补灰行 label）；双核分叉 V5F{readout, inputs:[SYSCLK], note:'HPRE=1'} / V3F{readout, inputs:[AHB], note:'HPRE×FPRE 合成'}；KernelMux 11 字段/AuxPlls 5 PLL **不建模**（组 note 列名）；MCO 按转录。
- **CH582**（CH583DS1 V1.9 图 6-1，p34；时钟章实为第 6 章）：无 HSI/无 AHB/APB 分频（AHB/APB1/APB2 kind readout + note ≡HCLK）；SYSCLK mux 三路 [PLL, HSE, CK32K]：CK32K displayOnly 灰行、HSE 行保留可选但导出已有 CLOCK_PRESET_UNAVAILABLE 边界（note）；PLL note ×15=480M、div 2..31（0=32、写 1 关 HCLK）；aux CK32KSEL{kind:mux, inputs:[LSI,LSE]} + RTC{kind:readout, inputs:[CK32KSEL], fixedMhz:0.032, note:'BLE 占用 RTC 时基（M12）；不生成'}；LSI/LSE displayOnly 源；**ADC 图/寄存器歧义**：图 6-1 把 ADC_CLK_DIV 画到 Fsys 轨，寄存器明确 CK32M÷10/4/6/8 → repo 采信 CK32M，P-ADC note 并列歧义。
- **X035/V003 长 note 溢出**（目检发现）：readout/peri/aux 的 hint/note 单行文本溢出横跨分组 → **U 域修复**：hint/note 截断至块宽（ellipsis）+ 全文入 `<title>` hover；分组 note 同理截断。

## D11 收尾裁决（用户目检反馈）

- **D11a 接入缓冲+垂直进入**：routeEdge 出/入锚点各加 STUB=14 水平缓冲段；末段必须水平垂直进入左缘锚点；`grazes()` 拒绝与簇边界重合的竖/横段（GRAZE=3）；走廊/通道在缓冲段之间错开。测试：七芯片首末段水平 ≥10px + 不擦边。
- **D11b 外设并联均衡列**：外设实例每列 ≤2 卡（>2 拆 ⌈n/2⌉ 列）、所有外设列顶边对齐同一 y（并联带）、列距 230/行距 128；分组框跨列单框包围；画布高度目标 ≤800px（解决「USART 出界」=画布过高视口外溢，坐标本身未越界）。

## D12 MX2 主干重构（2026-11-18 用户裁决，取代 D11b 的左右均衡列）

> 用户参照 CubeMX2 时钟树截图裁决：输入 LSI/LSE/HSE/HSI 左列竖排；主干 System Mux→System Clock→AHB Prescaler→HCLK 水平；**输出右列上下并联竖排**（MX2：To Power / To AHB bus,core,memory and DMA / To FCLK / Cortex System Timer / APBx Prescaler→To APBx Peripherals / To TIMx / USB）；**外设（SPI/I2C/USART/ADC）上下并联竖排**（「并联是上下并联不是左右」）。图二外设区=peri 卡单列竖排、按类别分组框上下堆叠。

**WCH 诚实映射**：MX2「To Power」在 WCH 无独立时钟域（PWR 挂 APB1）→ 不造假行；DMA/存储器并入 CORE 行标签；「Cortex clock/System timer」→ RISC-V 内核=HCLK、SysTick 按 HAL 事实（见下表）。CORE/SYSTICK 用 **aux 仅显示派生行**（不生成、不进配置）。

**模板坐标（七芯片统一，G 域照此迭代）**：
- 源列 x=40 竖排：HSI y≈58、HSE y≈140、displayOnly LSI/LSE y≈220/300（ch582 按其 sources/aux 现状）。
- PLL x=300 y≈60；SYSCLK x=600 y=240；AHB x=880，y=SYSCLK.y+muxH/2−22（muxH=24+行数×16；保证主干同 y 水平直连）。
- **输出竖列 E**：读数卡右对齐 E_RIGHT=1400（readout x=1296；div 簇 x=1188；ADC mux x=1200）。行序顶→底、行距 76、起 y=60：CORE(H417=V5F) → SYSTICK(H417=V3F) → (H417 第三行 SYSTICK) → APB1 → TIM1 → APB2 → TIM2 → USB(若建模) → ADC。分组框 g-out 包围（label「总线 / 内核输出」）。
- **外设竖列 F** x=1560 单列上下并联：类别序 usart→spi→i2c→adc，卡距 120（PERI_H96+24），起 y=60；分组框 g-usart/g-spi/g-i2c/g-adc 上下堆叠（x=1544 w=222，y=顶−30，h=n×120−24+48，组间距 24）。**禁止左右多列**。
- aux 带左下 y≥400、右缘 ≤1012（RTC/IWDG/AWU/MCO/USBPRE/ADCPRE/PLL2/3/USBHS/CK32KSEL 全保留）；g-aux 不与 g-sources/g-pll/g-sys/g-out 重叠。
- **lanes 干线共享**：AHB→E 各行的边 lanes=0（同走廊竖段共线=MX2 竖直干线观感）；APB1→peri=0、APB2→peri=1、ADC→P-ADC=2（E/F 间三条平行干线）。
- 画布宽 ≤1850；高度=外设列底+36（接受竖排带来的高度，fit-zoom 全览）。

**aux  schema 扩展（E 域）**：`AuxClockDomain += deriveDiv?: number; group?: string`。readout 且 fixedMhz=null 且单输入 → inMhz=输入节点 outMhz、outMhz=输入 outMhz÷(deriveDiv??1)（model.ts aux 段，主节点已推入后查表）；group 缺省 'g-aux'，CORE/SYSTICK/V5F/V3F 用 'g-out'（groupOrder 增补）。validate 5c：deriveDiv 正数、group 若给须存在于 diagram.groups 且包围该节点。

**逐芯片 SYSTICK/CORE 事实（HAL 逐字，note 必引）**：
| 芯片 | SYSTICK deriveDiv | 证据 |
|---|---|---|
| V003 | 1 | delay/impl_qingke_v2_v4.rs：set_stclk(Stclk::HCLK)，P_US=hclk/1e6（QingKe V2） |
| V103/V203 | 8 | delay/impl_qingke_v3.rs：P_US=sysclk/8/1e6（QingKe V3） |
| V307 | 1 | impl_qingke_v2_v4.rs（QingKe V4）STCLK=HCLK |
| X035 | 1 | delay/impl_systick_v4x7.rs：set_stclk(Stclk::HCLK) |
| H417 | 1 | delay/impl_systick_v3f_v5f.rs：RM §4.6 两计数器均 V3F HCLK 域；V5F=SYSCLK÷1、V3F=AHB÷1（deriveDiv=1，group g-out） |
| CH582 | 8 | ch58x-hal systick.rs：hclk_div8 |
CORE（除 H417）：{kind:readout, label:'内核 / DMA / 存储器', inputs:[{id:'AHB',label:'HCLK'}], deriveDiv:1, group:'g-out', note:'MX2 To AHB bus,core,memory and DMA / To FCLK 对应行；RISC-V 内核=HCLK；仅显示不生成'}。SYSTICK label='系统定时器 SysTick'，fixedDivLabel='÷8' 或 '÷1 (STCLK=HCLK)'。CH582 无 USB 时钟建模 → 无 USB 行（note 诚实）。

**测试（E 域）**：七芯片结构断言——peri 单列同 x、y 递增且类别块连续；E 列右缘=1400 且行序递增；源列同 x；CORE outMhz==hclk、SYSTICK==hclk÷deriveDiv；既有缓冲/擦边/不穿块/aux 元数据断言保留（fallout scoped）。README 快照仅「仅显示域」增 CORE/SYSTICK 行（主控审查 diff）。

## D12bis 坐标基线实测补记（G 域落地后主控核，2026-11-18 夜）

- 1 参数 PLL 簇宽 284：PLL x=300 与 SYSCLK x=600 间距 16 < 2×STUB → pll-sys 缓冲退化 8px 违反 D11a。基线修正：**PLL x=290~292**（V003/V203/CH582）或 **SYSCLK x=620**（V307/H417）；X035 SYSCLK 单 mux 行（muxH44）→ AHB y=240。
- USBPRE 放 PLL 右缘外 x=600~620（V103 两参数 PLL 右缘 668 → x=600 走 y232 通道）；ADCPRE 最右 ≤1100。
- lanes pll-usb 逐芯片实测：V203 −8、V103 −10、V307 +11、H417 无 USB 行；补充通道 lanes（apb1-tim1/apb2-tim2=0、apb2-adc=6、aux-MCO-PLL/aux-USBPRE-PLL=−8）纯为通道间距质量。
- 外设组框 h=n×120+24、组间 24 → 跨组卡距 168（组内 120）；画布高=外设列底+36：V003 696 / X035 1032 / CH582 1032 / V103 1176 / V203 1416 / V307 2016 / H417 2376（18 卡竖排自然结果，fit-zoom 全览，接受）。
- H417/CH582 peripheralClocks 无 usb → 无 USB 行（diagram 写未知节点会 validate 失败）；H417 不建 CORE（V5F/V3F 即内核行）。
- model 归组：TIM1/TIM2/ADC 域/USB/APB1/APB2 → g-out（g-tim/g-usb 退役）；回退列式测试过滤 g-out aux（CORE/SYSTICK 坐标仅对 diagram 竖列有意义）。

## D5 模型（E 域）

tree/model.ts：kind 默认（源=osc；SYSCLK/ADC 域=mux；PLL=pll；AHB/APB=div（options 单档→readout）；TIM/USB=readout；P-*=peri）；diagram.nodes[id].kind 覆盖优先；aux 节点/边按 D4；displayOnly 源排除 control options + 边 active=false；`ClockNodeModel` 增 `kind: ClockNodeKind` + `displayOnly?: boolean`（tree/model.ts，types 的 kind 类型 import）。computeClock/validateClock/solvePll/resolveClockIssues/matchPreset/mergeClockConfig **零改动**（aux 无配置）。

## D6 布局引擎（E 域）

layout.ts：PRIM 常量 export；有 diagram→坐标取数据（w/h 按 kind 算）、groups 取数据或成员包围盒、lanes hint；无 diagram→M15 列式回退（kind 簇尺寸仍用 PRIM）；锚点按 D2；正交+不穿块；画布尺寸=max 簇右下+40/36。

## D7 渲染（U 域）

ClockNode.vue 按 kind 重写（簇内块绝对偏移用 PRIM）；共享 CSS 抽 components/clock/primitives.css（radio/stepper/读数/osc/peri 样式，从现 scoped 提升）；编辑态通路保留（foreignObject + .node 类 + edit-start/end）；锁图标/issue marker/contextmenu 保留（簇右上）；ClockCanvas 白纸面板（去 radial-gradient）+分组框 11px 标题+pan 守卫核对（.node/foreignObject 形状不变）；ClockWire 不变（points 由 layout 给）。Detail/表格/菜单/高亮 **零改动**。

## D8 测试（E 域）

clockTree.test.ts 几何硬断言 6 处（:222/:230/:263/:270/:292/:646 列式公式）改写为 diagram 驱动：坐标=数据值、簇尺寸=PRIM、锚点正交、走线不穿簇（含 aux）、分组覆盖/不重叠；无 diagram 回退用例保留列式断言（合成 spec）。元数据/锁定/外设/高亮/USB 断言保留。新增 ≥25：aux 节点元数据（displayOnly/badge/control null/lockable false）、aux 边 active=false、displayOnly 源不进 options、mux 灰行、diagram kind 覆盖、validate 5c 各分支、PRIM 行距约束。clockLock/clockInlineEdit 几何无关保留。

## D9 边界

I2S mux/KernelMux 不画不建模；aux 不生成不进配置；V203 prediv/非预设 PLL 显式导出暂缓（M17）；单位切换不做；MCO/RTC div 显示固定档（无配置旋钮）。

## D10 门禁与验收

1456+ 全绿；vue-tsc/eslint/validate 7 芯片 0/0/build；verify:build 6/6+6/6+1/1 且 **codegen 快照逐字节不变**；七芯片浏览器截图对照 docs/m16-rm 转录 + MX2 图元原则（验收前干净 reload）；M15 交互抽查 V203（SPI 警告/ADC raw/Reset/高亮/跳转）。

## 文件域（排他）

- 主控：types/clock.ts（已落）、本契约、集成/门禁/验收/文档/推送。
- R1：docs/m16-rm/{v003,v103,x035}.md + /tmp/m16-rm1/<doc>/ 新目录解包。
- R2：docs/m16-rm/{v203,v307,h417,ch582}.md + /tmp/m16-rm2/<doc>/。
- E：src/model/clock/tree/{model,layout}.ts、scripts/validate-device-data.mjs、tests/{clockTree,clock,clockLock,clockInlineEdit}.test.ts（几何相关）。
- U：src/components/clock/ClockNode.vue、primitives.css（新）、src/components/ClockCanvas.vue、（ClockWire 仅核对不改除非锚点消费 bug）。
- G1：data/devices/{ch32v003f4p6,ch32x035c8t6,ch582m}/clock.json（diagram+aux+displayOnly）。
- G2：data/devices/{ch32v103c8t6,ch32v203c8t6}/clock.json。
- G3：data/devices/{ch32v307vct6,ch32h417qeu6}/clock.json。
- G 域启动条件：R 对应转录 + E 引擎落地（schema 已冻结可先写 aux/diagram 数据，坐标迭代待 E）。