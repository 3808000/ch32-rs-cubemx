# M18-S5 Clean-room Spike：把 `LIBCH58xBLE` 逆向/重写为 Rust 的法律与技术可行性

> 日期：2026-11-19　状态：**仅调研报告（Track B）**。本里程碑**不做任何重写实现、不开上游 issue/PR、不 fork**；本期 vendored blob 路线不变（M17 决策继续有效）。
> 定位：本文件是 M19+ 若启动「Rust 原生 BLE 协议栈」重写的**唯一决策依据**，不是设计文档、不是契约。
> 只读证据：`/home/teze/CH32/EVT/CH583EVT/`（EVT 全量）、`vendor-src/ch5xx-ble/vendor/LIBCH58xBLE.a`（nm/size/readelf/strings 元数据）、`/home/teze/zephyrproject/zephyr@85433bf`（v4.4.2 本地快照）、GitHub API 只读查询。
> **诚实边界**：本文的法律部分为工程师层面的条文梳理，**不是法律意见**；对外发布、上游 PR、商业分发前必须由执业律师复核。所有工作量数字为量级估计（人月，±30%）。

---

## 0. 一页速览

| 问题 | 结论 |
|---|---|
| WCH 有没有「禁止逆向」条款 | **没有**。140 个 EVT 头/源文件（106 `.h` + 34 `.c`）中唯一相关语句是限用范围句，逐字见 §2.1(a)。手册另有一条「不得复制/泄露/散布手册信息」的版权声明（对象是**手册**，不是二进制）。 |
| WCH 有没有「限芯片」条款 | **有**，且是全仓唯一授权性语句：`binary are used for microcontroller manufactured by Nanjing Qinheng Microelectronics`。这是 field-of-use（使用范围）限定，不是反向工程禁令。 |
| 还有别的限制吗 | 手册免责声明：`未经…书面许可，任何人不得因任何目的、以任何形式（包括但不限于全部或部分地向任何人复制、泄露或散布）不当使用本产品手册中的任何信息`。→ 规格组**禁止逐字摘抄手册**。 |
| 开源 LL 推荐 | **NimBLE（Apache-2.0）为首选移植基座**；Zephyr（Apache-2.0）为备选（更完整但移植面更大）；rubble（0BSD，已归档）只作 Rust 形态参考；BTstack **不可用**（第 4 条禁商用）；NuttX/nrf-softdevice/BlueZ/ESP-IDF 均不适用（理由见 §3.2）。 |
| RF 黑盒占比 | 代码量 **9.0%**（18,971 / 210,602 B 文本段）；导出符号 **11.0%**（28/255，其中校准/调谐 12 个）；但**工程关键路径上 RF 文档缺口 = 100% 阻塞**（无 CH583 RM/DS 在本地，公开头文件零 RF 寄存器定义）。 |
| 总工作量 | 方案 A（spec-first 自研）**20–30 人月**；方案 B（移植 NimBLE LL + 自研/移植 host）**13–22 人月**（中位 ~16）；BQB/射频一致性另计 **3–6 人月 + 外部费用**。两方案在 RF 段无差别，RF 段 4–8 人月且不可压缩。 |
| 建议 | 重写立为 **M19+ 独立里程碑**，与当前产品线解耦；上游 PR 重启需满足 4 条硬条件（§7.2）；**本期继续 vendored blob**。 |

---

## 1. 方法与证据边界

### 1.1 本次做了什么

| 类别 | 手段 | 说明 |
|---|---|---|
| WCH 条款 | `grep` 全 EVT 头/源 + `pdftotext` 全文检索 + `pdfinfo` 元数据 | 逐字取证，未做解释性改写 |
| blob 盘点 | `nm -g --defined-only`、`size`、`readelf -S/-s`、`strings`、`ar t` | **未运行 objdump 反汇编**；仅元数据与符号表 |
| 开源 LL | 本地 Zephyr 快照 + GitHub API（`api.github.com` 可达）+ codeload 源码包离线计数 | btstack/nimble/rubble 的许可与规模均取自原文/源码，不靠记忆 |
| 法律 | 条文与判例按通行文本引用，并标注核对状态 | flk.npc.gov.cn / 司法文书站点为 SPA 或不可达，未能机器取回原文（见 §2.6） |

### 1.2 明确没做的事

- 没有反编译、没有反汇编、没有把任何反编译产物写入本文件或仓库。
- 没有修改除本文件之外的任何文件；没有提交上游 issue/PR；没有 fork。
- 没有执行任何 WCH 二进制；没有在真机上做新的 RF 测量。

### 1.3 取证环境限制（影响结论强度）

| 项 | 状态 | 影响 |
|---|---|---|
| `github.com:443` 直连 | 不可达（`curl` 连接被拒） | 改用 `api.github.com` + `codeload.github.com`（均可达），源码包离线计数 |
| `WebFetch` | 失败（`ECONNREFUSED 127.0.0.1:443`，代理配置异常） | 所有网络结论均由 `curl` 直接取证 |
| WCH 官网（`wch.cn` / `wch-ic.com`） | HTTP **200**，但返回的是 JS SPA 壳页面 | **内容层不可达**：未取到任何静态许可/条款原文，也未取到 CH583DS1/下载页。已在 §2.1(e) 记为「不可达」而非「无条款」 |
| 本地 CH583 RM/DS | **不存在**（`find /home/teze -maxdepth 6` 仅命中 EVT 的 4 份板级/PCB 文档） | RF 章节覆盖度只能以「本地可验证范围为 0」表述 |
| 中文法规数据库 | `flk.npc.gov.cn` 200 但为 SPA；`pkulaw` 567 | 条文文本按通行版引用，标注「建议外发前复核」 |

---

## 2. 法律：条款原文、解释与风险

### 2.1 条款原文（逐字）

#### (a) `CH58xBLE_LIB.h` 文件头（`/home/teze/CH32/EVT/CH583EVT/EVT/EXAM/BLE/LIB/CH58xBLE_LIB.h:1-9`）

```
/********************************** (C) COPYRIGHT ******************************
 * File Name         : CH58xBLE_LIB.H
 * Author            : WCH
 * Version           : V2.10
 * Date              : 2024/03/18
 * Description       : head file
 * Copyright (c) 2021 Nanjing Qinheng Microelectronics Co., Ltd.
 * Attention: This software (modified or not) and binary are used for
 * microcontroller manufactured by Nanjing Qinheng Microelectronics.
 *******************************************************************************/
```

**这是全仓唯一带授权/限制语义的语句**，且在 **140 个文件**（106 `.h` + 34 `.c`）中重复；覆盖 BLE 各例程的 `peripheral.h` / `gattprofile.h` / `devinfoservice.h` / `app_*.c` 等。逐字比对：其中 135 个文件与上引完全一致，另 5 个文件仅在 `for` 之后多一个尾空格（**文字相同，仅空白差异**；`grep -rh ... | sort -u` = 2 种，`cat -A` 可见 `for ^M$`）。

语法注记（重要，不要读成「禁止」）：

- 原文缺冠词/介词，是中式英语；语义为「本软件（无论是否被修改）与二进制，均用于南京沁恒微电子制造的微控制器」。
- 它**没有**出现 `reverse engineer` / `decompile` / `disassemble` / `禁止逆向` / `不得反向工程` 等任何字样；全 EVT 检索（中英）亦无命中。
- 它**没有**明示授予复制、发行、演绎许可；因此它是一条 **field-of-use 使用范围限定**，不是许可合同全文，也不是禁止性条款。

#### (b) 《沁恒低功耗蓝牙软件开发参考手册 v1.9》（2025-07-17）「版本声明与免责声明」（末页，逐字）

```
本手册版权所有为南京沁恒微电子股份有限公司（Copyright © Nanjing Qinheng
Microelectronics Co., Ltd. All Rights Reserved），未经南京沁恒微电子股份有限公司
书面许可，任何人不得因任何目的、以任何形式（包括但不限于全部或部分地向任何人复制、
泄露或散布）不当使用本产品手册中的任何信息。

任何未经允许擅自更改本产品手册中的内容与南京沁恒微电子股份有限公司无关。
南京沁恒微电子股份有限公司所提供的说明文档只作为相关产品的使用参考，不包含任
何对特殊使用目的的担保。南京沁恒微电子股份有限公司保留更改和升级本产品手册以及手
册中涉及的产品或软件的权利。

参考手册中可能包含少量由于疏忽造成的错误。已发现的会定期勘误，并在再版中更新
和避免出现此类错误。
```

要点：**对象是「本产品手册中的任何信息」**，不是库二进制；动词是「复制、泄露、散布」+「不当使用」。它对「读手册后自己重新实现」的约束力弱于对「把手册内容搬进自己文档」的约束力——这直接决定 clean-room 规格组的写作规则（§5.3）。

#### (c) 《WCH 蓝牙空中升级（BLE OTA）v1.2》

`pdfinfo` 无版权字段；`pdftotext` 全文（含首页与末页）检索 `版权|声明|限制|禁止|许可|所有权|未经|保留|商标|专利` **零命中**。结论：**该 PDF 无使用限制声明**。

#### (d) 其它 EVT 文本

| 文件 | 内容 | 许可语句 |
|---|---|---|
| `EVT/CH583_List.txt` / `CH583_List_EN.txt` | 目录说明 + `http://wch.cn` | 无 |
| `EVT/EXAM/FreeRTOS/readme.txt`、`HarmonyOS/readme.txt`、`RT-Thread/readme.txt` | 移植说明（含「蓝牙中断为库内中断函数，使用了免表中断方式…StartUP.S 中已把 BB_IRQLibHandler 和 LLE_IRQLibHandler 放入中断向量表」） | 无 |
| `EVT/PUB/CH583EVT Evaluation Board Manual.pdf`（11 页）、`CH583SCH.PDF`、`CH583评估版说明书.pdf`（10 页）、`蓝牙芯片的电路及PCB设计的重要注意事项.pdf`（3 页） | 板级/PCB/天线布局指导 | 无（且**均非 RM**，不含 PHY 寄存器章节） |

#### (e) 官网条款：**不可达（内容层）**

- `https://www.wch.cn` → 200；`https://www.wch-ic.com/downloads/CH583DS1_PDF.html` → 200；但返回体均为 Vue SPA 壳（`<div id="app">` + `/js/*.chunk.js`），**无任何静态许可文本、无静态 PDF 链接**。
- `https://www.wch.cn/search?keyword=CH583` → 302（重定向到 SPA 路由）。
- 结论：**「官网是否另有 SDK 许可协议」在本次取证条件下无法确认**；不得据此推定「WCH 未附许可」。这是 §7.3 待裁决事项之一。

#### (f) 条款结论表

| 问题 | 结论 | 证据 |
|---|---|---|
| 有「禁止逆向工程」条款？ | **无** | 全 EVT 中英检索零命中；106 处头文件仅 §2.1(a) 一句 |
| 有「禁止反编译/反汇编」条款？ | **无** | 同上 |
| 有「限芯片使用」条款？ | **有**（唯一授权性语句） | §2.1(a) `used for microcontroller manufactured by Nanjing Qinheng Microelectronics` |
| 有明示的复制/发行许可？ | **无明示**（推定随 EVT 提供） | §2.1(a) 只有使用范围句，无 grant 条款 |
| 手册内容可自由引用？ | **不可**（书面许可为前提） | §2.1(b) |
| OTA 文档有额外限制？ | 无 | §2.1(c) |
| 官网另有条款？ | **未知（内容层不可达）** | §2.1(e) |

### 2.2 条款解释：三句话讲清

1. **「限芯片」不等于「禁逆向」，也不等于「授权你做什么」。** 该句把使用范围锁在沁恒 MCU 上；对「在沁恒 MCU 上重写一套栈」这件事，它既不授权也不禁止——空白由著作权法与合同法填补。
2. **没有明示许可 = 复制/发行仍受著作权约束。** 因此「把 blob 放进开源仓库并随生成的 ZIP 分发」（M17 现状）在法律上依赖的是「随 EVT 提供的默示许可 + 目标芯片仍是沁恒」这一事实基础，而不是一纸许可。这个基础**足以支撑本期产品**，但**不足以支撑上游 PR**（§7.2 硬条件 C）。
3. **手册声明是本项目最需要守的一条。** 它约束的是「信息」的复制与散布；规格文档若整段抄手册，等于把「表达」搬进了自己的工程。规避方式不是法律论证，而是流程：**读后用自己的话重写 + 只保留行为事实 + 记录来源**（§5.3）。

### 2.3 法条与判例（逐条 + 对项目的适用与边界）

| # | 规范 | 关键内容（要点式引用） | 对本项目的意义 | 边界/别踩的坑 |
|---|---|---|---|---|
| L1 | 《计算机软件保护条例》**第六条** | 「本条例对软件著作权的保护不延及开发软件所用的思想、处理过程、操作方法或者数学概念等。」 | 思想/表达二分的中文本土依据：**协议行为、状态机语义、算法思想**不受保护；受保护的是具体表达（代码文本、注释、手册文字、独特结构）。 | 「指令序列/代码结构」在某些情形仍可能被视为表达；不能据此认为「照抄结构改写成 Rust」安全。 |
| L2 | 同条例**第十六条** | 合法复制品所有人可：装入、制作备份、**为实际应用环境或改进功能性能作必要修改**；但未经许可不得向第三方提供修改后的软件。 | 说明「修改自用」有空间；**对外分发修改版没有**。 | 与 clean-room 无关（clean-room 不修改原库）；对「把 blob patch 后再分发」是红线。 |
| L3 | 同条例**第十七条** | 「为了学习和研究软件内含的设计思想和原理，通过安装、显示、传输或者存储软件等方式使用软件的，可以不经软件著作权人许可，不向其支付报酬。」 | 学习研究豁免的**行为清单是「使用」**（安装/显示/传输/存储），不是「复制发行/演绎」。 | **不能作为「重写并发布」的抗辩**；只能覆盖研究阶段的使用行为。且不豁免商业秘密与合同义务。 |
| L4 | 同条例**第二十四条** | 未经许可复制/部分复制、发行、出租、信息网络传播等构成侵权（民事责任）。 | 若重写过程中产生「与原实现实质相似的代码」，落入此条。 | 这正是 clean-room 要防的结果；「独立创作」需可举证。 |
| L5 | 最高法《关于审理不正当竞争民事案件应用法律若干问题的解释》（法释〔2007〕2 号）**第十二条** | 「通过自行开发研制或者反向工程等方式获得的商业秘密，不认定为…侵犯商业秘密行为。前款所称反向工程，是指通过技术手段对从公开渠道取得的产品进行拆卸、测绘、分析等而获得该产品的有关技术信息。当事人以不正当手段知悉了他人的商业秘密之后，又以反向工程为由主张获取行为合法的，不予支持。」 | **反向工程不侵犯商业秘密**，前提是：①对象是**从公开渠道取得的产品**（EVT 与 .a 为公开发布）；②手段正当；③无「不正当手段在先」。 | ①「公开渠道」需能举证（WCH 官网/EVT 包获取记录）；②若曾签 NDA 或绕过技术措施取得，则豁免不成立；③该条不豁免著作权。⚠ 该解释引用的《反不正当竞争法》条号系旧法（2019 年版为第九条；2025 年修订后条号有调整），**外发引用前须按现行文本核对条号**。 |
| L6 | TRIPS 协定第 9 条第 2 款 / 条例第六条 | 「版权保护延及表达，而不延及思想、程序、操作方法或数学概念本身。」 | 国际口径与 L1 一致；支撑「按 BT Core 规范重写」的正当性。 | 同上，不保护「逐字翻译」。 |
| L7 | **SAS Institute v. World Programming, C-406/10**（EU 大法庭，2012-05-02） | ①程序的功能、编程语言、数据文件格式**均不构成受保护的表达**；②但用户手册若具独创性可受保护；③合法用户可依 2009/24/EC 第 5(3) 条观察、研究、测试以确定思想与原理；④依第 6 条的反编译须满足互操作性等条件，且不得用于制作实质相似的程序。 | 欧洲法下「按功能重写」的正当性最清晰的判例；「不得抄手册」与 §2.1(b) 相互印证。 | ①判例属地效力（EU）；②第 6 条反编译有严格条件，不能当作通用许可；③「功能不受保护」不等于「接口文本可抄」。 |
| L8 | **Google LLC v. Oracle America, 593 U.S. 1 (2021)** | 假定 API declaring code 可版权，11,500 行声明代码的复制构成 **fair use**（6–2）。 | 美国法下「为互操作复用接口声明」的最强支持；对「重写 API 兼容层」有参考价值。 | ①**未判决 API 不可版权**；②fair use 是事实密集型、逐案判断；③不覆盖实现代码；④仅美国法。 |
| L9 | **DMCA 17 U.S.C. §1201(f)**（互操作例外） | 合法取得程序复制品使用权者，可为**识别与分析实现互操作所必需的要素**而规避访问控制，并可开发/提供互操作手段，前提是该要素「此前不能轻易获得」且行为不构成侵权。 | 若未来需要绕过 OTA/读保护等技术措施做互操作分析，这是美国法下的窄豁免。 | ①仅覆盖「访问控制」规避；②「不能轻易获得」是硬条件；③不豁免著作权本身。**本项目当前不需要触发**（.a 未加密）。 |
| L10 | **EU 2009/24/EC 第 5(3)、6、8(2) 条** | 5(3)：合法用户可在加载/显示/运行/传输/存储时观察、研究、测试以确定思想原理；6：为互操作反编译（附条件）；**8(2)：与 5(2)(3)、6 相反的合同条款无效**。 | 若面向欧盟发布，「合同不能剥夺观察/研究权」是重要支点（对 §2.1(a) 的限用句有制衡）。 | ①仅 EU；②6 条不得用于制作实质相似程序；③8(2) 不使「限制使用范围」整体无效，仅限所列条款。 |
| L11 | 《集成电路布图设计保护条例》**第二十三条**（类比） | 为评价、分析、研究、教学目的复制布图设计，及在此基础上创作具独创性的布图设计，可不经许可、不付报酬。 | 中国法对「芯片层反向工程」的**立法态度**（允许分析、要求独创性）可作类比论证。 | **对象是布图设计，不是软件**；只能作类比，不能直接援引。 |
| L12 | **Bluetooth SIG** 专利/版权许可（PCLA）+ 资格认证 | 成员间对「符合规范的实现」授予免许可费的必要专利许可；Core Spec 文本版权归 SIG；产品需 BQB/QDID 声明。 | 自研 LL 一旦出货，**产品**进入 SIG 的 SEP 许可与认证体系（与代码是否原创无关）。 | ①非成员不享专利许可；②BQB 是**产品级**，不是代码级；③认证费用/周期另计，且需 DTM 支持。 |
| L13 | 《民法典》第 577 条（违约责任）、第 186 条（责任竞合） | 违反合同义务独立承担违约责任；同一行为可同时构成违约与侵权，受损害方可择一或并行主张。 | **合同之诉独立于侵权之诉**：即使重写不侵权，若违反 §2.1(a) 的使用范围或官网 SDK 协议，仍可能被诉违约。 | 违约责任不以「抄袭」为前提；「独立重写」不是违约抗辩。 |

### 2.4 权利链风险：这条最容易被忽略

**观察（待核实事实，非结论）**：blob 的模块划分与 API 命名与 TI **BLE-CC254x** 协议栈高度同构：

- 目标文件名逐字对应：`peripheral.o` / `central.o` / `broadcaster.o` / `observer.o` / `gapbondmgr.o` / `gattservapp.o` / `att.o` / `gap.o` / `gatt.o` / `l2cap.o` / `sm.o` / `hci.o`；
- API 前缀逐字对应：`GAPRole_*`、`GATTServApp_*`、`GAPBondMgr_*`、`ATT_*`、`SM_*`、`L2CAP_*`；
- 调度/内存层 `tmos` / `tmos_msg_allocate` / `tmos_snv` 与 CC254x 的 OSAL 概念一一对应，`tmos_event_hdr_t{event,status}` 亦同构。

**含义**（不下定论，只列影响）：

1. 若 WCH 库确由 TI 代码派生，则**权利链不止 WCH 一家**；即使取得 WCH 书面许可，仍可能存在第三方权利。
2. 这反而**增强 clean-room 的价值**：不看实现、只按公开规范重写，天然绕开「派生作品」的传染性。
3. 对上游 PR 的「许可清理」提出额外要求：需 WCH 书面确认其有权授权（或至少确认不再主张），否则开源仓库分发 blob 的风险无法闭合。

**核实方式（M19 若启动再做）**：比对 TI BLE-CC254x 公开头文件的 API 清单与 WCH 头文件的重合度（公开资料比对，不涉及反编译）；向 WCH 发函询问代码来源与许可。**本期不做。**

### 2.5 风险矩阵

| ID | 风险 | 触发场景 | 等级 | 缓释 |
|---|---|---|---|---|
| R1 | blob 再分发无明示许可 | 仓库 vendoring + 生成 ZIP 分发 | 中（本期可接受） | ①保留 WCH 版权头不改；②README 标注「WCH 专有，使用受 WCH 条款约束」（M17 已做）；③向上游 PR 前取得书面许可或改为「从官方 EVT 下载」 |
| R2 | 手册内容被抄进规格/文档 | 规格组偷懒整段复制 | 中高 | §5.3 强制「重写 + 来源标签 + 禁逐字」；审计抽查 |
| R3 | 重写代码与原实现实质相似 | 实现组看过反编译输出 | 高 | §5.2 材料分级；反编译产物**永不进实现组**；提交留痕 + 代码相似度抽检 |
| R4 | 合同违约之诉（独立于侵权） | 违反限用句 / 官网 SDK 协议 | 中 | ①目标芯片始终为沁恒；②取得官网协议原文（§7.3-1）；③律师意见 |
| R5 | SEP / SIG 许可缺口 | 自研 LL 出货、未入 SIG | 中高 | 评估 SIG 会员 + BQB；或维持「芯片厂商已获许可」的现状（blob 路线天然覆盖） |
| R6 | 商业秘密主张（校准算法） | 规格组把 `RFEND_*` 行为逆向成文档并公开 | 中 | 校准段规格**不公开**；仅内部实现组可见；或改用独立表征（自测校准曲线） |

---

## 3. 技术：开源 LL 盘点

### 3.1 评估准则

1. **许可**：能否用于闭源商业固件、能否再分发、是否有 field-of-use 限制。
2. **语言/可移植性**：C 还是 Rust；HAL 抽象是否「为移植而设计」。
3. **LL 完整度**：adv/scan/conn/加密/隐私/2M/扩展广播/周期广播/ISO。
4. **移植到 CH582 需自写什么**：RF 驱动、时钟/ticker、中断/SWI、加密引擎、OS 胶水。
5. **维护状态**：是否归档、最近提交。
6. **资质**：是否通过 BQB（组件级 vs 产品级）。

### 3.2 逐项结论

#### (1) Zephyr `subsys/bluetooth/controller` —— Apache-2.0，完整，移植面中等偏大

- **许可**：仓库根 `LICENSE` = Apache-2.0；控制器源码头 `SPDX-License-Identifier: Apache-2.0`（如 `ll_sw/ull.c`，`Copyright (c) 2017-2021 Nordic Semiconductor ASA`）。
- **版本**：本地 `/home/teze/zephyrproject/zephyr` @ `85433bf4504d10ebc0e9f965fe556f2c4794bfa1`，v4.4.2（2026-09-07 快照）。
- **架构（关键）**：`BT_LL_SW_SPLIT`（Kconfig：`bool "Software-based Bluetooth LE Link Layer"`，help：`Use Zephyr software Bluetooth LE Link Layer ULL LLL split implementation.`）
  - **ULL**（Upper Link Layer，线程上下文）：`ll_sw/ull_*.c`，角色状态机 + `ull_sched.c` 调度 + LLCP（`ull_llcp*.c`）。
  - **LLL**（Lower Link Layer，无线电中断上下文）：`ll_sw/lll_*.c` + 厂商实现 `ll_sw/nordic/lll/*`（19,328 行）或 `ll_sw/openisa/lll/*`（4,829 行）。
  - **ticker**：`ticker/ticker.c`（4,274 行），基于 HAL ticker（nRF 上挂 RTC）。
  - **HAL 接口**（极薄，共 204 行头）：`hal/radio.h`、`hal/ticker.h`、`hal/swi.h`、`hal/ecb.h`、`hal/ccm.h`、`hal/cntr.h`、`hal/cpu.h`、`hal/debug.h`。
- **规模**：控制器目录合计 **123,512 行**（C/H）；其中通用 `ll_sw/*.c` **53,024 行**、Nordic LLL **19,328 行**、Nordic HAL **4,106 行**（`radio/radio.c` 2,828 行）、ticker 4,274 行。
- **移植到 CH582 需自写**：
  1. `hal/radio`：射频收发、白化/CRC/AA/PDU 组帧、时间戳、DMA——**CH582 寄存器未知（§4）**；
  2. `hal/ticker`：32K 域定时（CH582 由 BLE 库独占，见 §4.6）；
  3. `hal/swi`：软中断（PFIC 可实现）；
  4. `hal/ecb` / `hal/ccm`：AES-128 + CCM（CH582 硬件 AES 存在但寄存器未知，可先软实现）；
  5. `hal/cntr`：自由运行计数器；
  6. **一套 CH582 LLL**（nRF 版 19k 行的等价物，或裁剪到仅 1M PHY/legacy adv 的 ~8–12k 行）。
- **阻抗失配**：ULL 深度依赖 Zephyr 内核（`ll_sw/ull*.c` 中 69 个不同 `k_*` API，`k_sem` 37 处、`k_work` 19 处）。在 Rust/bare-metal 上要么移植内核子集，要么大改。
- **内存**：32 KB SRAM 对 Zephyr 控制器（默认缓冲/ISO 代码路径）偏紧，需大幅裁剪。
- **工作量量级**：**8–14 人月**（仅控制器移植 + OS/内核胶水；**不含** M25 的 RF 驱动/校准 4–8 人月、host 强化与 BQB，避免与 §6.1 的合计重复计数）。

#### (2) Apache NimBLE —— Apache-2.0，完整，移植面最小（推荐）

- **许可**：`LICENSE` = Apache License 2.0（本地解包 `master` 校验）。
- **仓库**：`apache/mynewt-nimble`，897 stars，Apache-2.0，未归档，最近推送 2026-11-17。
- **结构**：控制器源码 `nimble/controller/src/*.c` 合计 **39,771 行**（`ble_ll.c`、`ble_ll_adv.c`、`ble_ll_conn.c`、`ble_ll_scan.c`、`ble_ll_ctrl.c`、`ble_ll_crypto.c`、`ble_ll_iso*.c`、`ble_ll_dtm.c` 等）。
- **HAL 抽象**（`nimble/controller/include/controller/`）：`ble_phy.h`（射频）、`ble_hw.h`（AES/随机数/特性）、`ble_ll_sched.h`（调度）、`ble_ll_tmr.h`（定时）、`ble_ll_rfmgmt.h`（RF 电源管理）。
- **移植面**：每颗芯片一个 `nimble/drivers/<chip>/src/{ble_phy.c,ble_hw.c,...}`；nRF51 的 `ble_phy.c` 仅 **1,538 行**，全部驱动移植合计 5,868 行 → **单芯片移植面 ~1.5–3k 行**，明显小于 Zephyr 的 LLL 改造。
- **OS 依赖**：控制器引用 42 个 `os_*` 符号（`os_mempool_*`、`os_mutex`、`os_time_*`、`os_cputime_*`），NPL（NimBLE Porting Layer）本就是为移植设计的薄层；`porting/npl/` 下已有 nuttx/riot/linux 等实现可参照。
- **完整度**：adv/scan/conn/LLCP/加密/隐私解析列表/ISO/DTM/扩展广播齐全，且带 `ble_ll_dtm.c`（认证用 Direct Test Mode）。
- **工作量量级**：**5–9 人月**（移植 LL + NPL + CH58x 驱动），host 另计。

#### (3) rubble —— 0BSD，已归档，不完整，仅作 Rust 形态参考

- **许可**：0-Clause BSD，逐字：「Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.」
- **状态**：`jonas-schievink/rubble`，403 stars，**archived = true**，最后推送 **2022-05-17**；README 首行：「**Note**: this project is not currently maintained.」
- **自述限制**：「Currently, Rubble supports Nordic's nRF52-series of MCUs.」+「**NOTE: None of this has been passed to the Bluetooth® Qualification Process, so it must not be used in commercial products!**」
- **规模**：`rubble/src` 合计 **11,276 行 Rust**（link 6,150 / att 1,582 / l2cap 629 / gatt 318 / ecdh 422）；`rubble-nrf5x` 驱动 746 行。
- **完整度硬伤**：依赖中**无 AES 实现**（仅 `p256` + `sha2`），`link/features.rs` 只声明 `LE_ENCRYPTION` 位而无链路层加密；无 2M/扩展广播/周期广播。即：**能广播、能建连，不能加密通信**。
- **价值**：Rust 的所有权/状态机写法、`phy.rs` 的通道/频率/白化抽象可直接借鉴（思想层面），不能当基座。
- **工作量量级**：作为参考 **0–2 人月**（不构成独立方案）。

#### (4) BlueKitchen BTstack —— **不可用**

- **许可原文**（`LICENSE`，逐字摘录条件 4）：
  > 4. Any redistribution, use, or modification is done solely for personal benefit and not for any commercial purpose or for monetary gain.
  末尾：「Please inquire about commercial licensing options at contact@bluekitchen-gmbh.com」。
- 即：**源码可见的「非商业」BSD 变体 + 商业双许可**；闭源商业固件必须付费授权。
- **技术上也不适用**：仓库内无内嵌 Link Layer（`src/ble/` 仅 host 侧 ATT/GATT/SM；其余为 `chipset/` 的 HCI 传输驱动）。它设计上就是「跑在有现成控制器的芯片/系统上」。
- 结论：许可与技术双否。

#### (5) Apache NuttX —— Apache-2.0，但**只有 host，没有 LL**

- `wireless/bluetooth/` 目录实测仅：`bt_att.c`、`bt_conn.c`、`bt_gatt.c`、`bt_l2cap.c`、`bt_smp.c`、`bt_hcicore.c`、`bt_netdev.c` 等 —— 纯 HCI host 侧，依赖外部控制器。
- 结论：不能作为 LL 基座；host 代码可作设计参考（Apache-2.0，但 C）。

#### (6) embassy-rs/nrf-softdevice —— 不适用

- crate 本体 Apache-2.0，但运行时依赖 **Nordic SoftDevice 二进制**（专有，仅授权 nRF 系列）。绑定寄存器与 IPC 机制都是 nRF 专有。
- 结论：许可与硬件双否。

#### (7) BlueZ —— GPL-2.0，不适用

- Linux 内核/用户态 host，GPL 传染性 + 运行环境不匹配（需 Linux）。固件不可用。

#### (8) ESP-IDF BLE 控制器 —— 不适用

- 控制器以**预编译库**形式分发（Espressif 专有），且绑定 ESP32 射频；许可与硬件双否。列此仅为排除「同样走 blob 路线」的对照。

#### (9) TI BLE-CC254x —— 不适用（但可能是 WCH blob 的上游）

- 非开源；TI 的 BLE 协议栈许可历来限定 TI 芯片。见 §2.4。

### 3.3 对比表

| 候选 | 许可 | 语言 | LL 完整度 | CH582 需自写 | 维护 | 判定 |
|---|---|---|---|---|---|---|
| **NimBLE** | Apache-2.0 | C | 高（含 ISO/DTM/扩展广播） | `ble_phy`/`ble_hw`(1.5–3k 行) + NPL + 调度胶水 | 活跃（2026-11） | **首选基座** |
| Zephyr CTLR | Apache-2.0 | C | 最高（ULL/LLL/DF/ISO） | radio/ticker/swi/ecb/ccm/cntr + 整套 LLL(8–19k 行) + 内核子集 | 活跃（v4.4.2） | **备选**（完整但重） |
| rubble | 0BSD | Rust | 低（无加密/无 ext adv） | `phy` 驱动 + 缺的半栈 | 归档 2022-05 | 仅参考 |
| BTstack | 非商业 BSD + 商业双许可 | C | **无 LL** | 全部 LL | 活跃 | **不可用** |
| NuttX | Apache-2.0 | C | **无 LL**（host only） | 全部 LL | 活跃 | 不可用 |
| nrf-softdevice | Apache-2.0 壳 + 专有 SD | Rust | 高（但 nRF 专用） | —（硬件不符） | 活跃 | 不适用 |
| BlueZ | GPL-2.0 | C | host only | — | 活跃 | 不适用 |
| ESP-IDF CTLR | 专有二进制 | C | 高（ESP32 专用） | —（硬件不符） | 活跃 | 不适用 |

### 3.4 推荐

**主方案：NimBLE 控制器（Apache-2.0）+ 自研 CH58x `ble_phy`/`ble_hw` 驱动 + 自研 Rust 上层（或移植 NimBLE host）。**
理由：①许可最干净（纯 Apache-2.0，无 field-of-use）；②控制器自带完整 LLCP/SM/加密/DTM，省掉最容易写错的 3–5 人月；③移植面是候选里最小的（单芯片 1.5–3k 行）；④OS 抽象层本就是为「换 OS/裸机」设计。

**备选：Zephyr 控制器。** 只在「需要 ISO/DF 或与 Zephyr 生态对齐」时才值得多付 3–6 人月与 32KB SRAM 的代价。

**明确不做**：把 rubble 当基座（不完整、已归档）；用 BTstack（禁商用、无 LL）。

---

## 4. RF 公开度与 blob 解剖

### 4.1 本地资料盘点：**RF 寄存器公开度 = 0（本地可验证范围）**

| 资料 | 是否存在 | 内容 | 对 RF 的价值 |
|---|---|---|---|
| `CH583DS1.PDF` / `CH583RM.PDF`（数据手册/参考手册） | **不存在**（`find /home/teze -maxdepth 6` 无命中） | — | 无法评估 RF 章节覆盖度 |
| `docs/m16-rm/ch582.md` | 存在 | **仅时钟树转录**（CH583DS1 图 6-1），标题即「CH582 时钟树转录」；全文无 `RF/radio/phy` 命中 | 0 |
| `docs/m16-rm/{v003,v103,v203,v307,x035,h417}.md` | 存在 | 其它芯片 RM 转录 | 0（非 CH58x） |
| `EVT/EXAM/SRC/StdPeriphDriver/inc/CH583SFR.h` | 存在 | 外设 SFR 定义 | `grep -E "BLE|RF|LLE|BB"` **零命中** |
| `EVT/EXAM/SRC/Startup/*.S` | 存在 | 启动/向量表 | `grep -i ble` **零命中**（说明中断向量由用户/库自行接线） |
| `EVT/PUB/*.pdf` | 4 份（11/10/3/1 页） | 评估板说明、原理图、PCB 设计注意事项 | 天线/匹配/布局指导，**无 PHY 寄存器** |
| `CH58xBLE_LIB.h` | 存在 | API 与结构体 | 有 `rfConfig_t`（通道/频率/AA/CRCInit/白化/PHY/RxMaxlen），**无寄存器地址** |
| 官网 | 200 但 SPA | — | 未取到 DS/RM |

**结论**：在本地可验证范围内，CH582 的 RF/BB/LLE 层**没有任何公开寄存器文档**。对照 `chip.json` 记载（CH583DS1 V1.9 曾被引用于引脚/电气），可推断 DS 覆盖的是电气与引脚，而非 PHY 寄存器表；**但该判断需以 DS 原文复核**（记为未决问题 Q1）。

### 4.2 blob 元数据（只读）

| 项 | 值 | 取证 |
|---|---|---|
| 归档成员 | **67 个 `.o`** | `ar t` |
| 文本段合计 | **210,602 B**（data 271 + bss 290） | `size -t` |
| 源文件符号 | **66 个 `FILE`**（如 `att.c`、`ll_advertise.c`） | `readelf -s` |
| 调试信息 | **DWARF 段 = 0**（无行号/变量） | `readelf -S \| grep -c debug_` |
| 符号表 | **1,387 个全局定义符号**（未剥离） | `nm -g --defined-only` |
| 编译器 | `GCC: (xPack GNU RISC-V Embedded GCC, 32-bit) 8.2.0` | `strings` |
| 架构 | RISC-V 32 位，静态归档 | `ar/size` |

含义：**技术上逆向门槛低**（符号完整、函数名语义化），**法律上更需隔离**（越容易看懂，越容易「看过就写出来」）。无 DWARF 意味着拿不到原始行号/结构，只能靠函数名与调用关系推断。

### 4.3 代码量分组（互斥分类）

| 组 | 文本段 B | 占比 | 说明 |
|---|---|---|---|
| **LL**（`ll_*` 16 个对象） | 70,865 | **33.6%** | `ll_pdu` 10,636 / `ll_advertise` 10,408 / `ll_connect` 9,728 / `ll_scan` 9,360 / `ll_initiate` 5,718 / `ll_slave` 5,290 / `ll_master` 4,960 |
| **HOST**（ATT/GATT/GAP/L2CAP/SM/HCI） | 62,270 | **29.6%** | `gap` 7,610 / `gap_central` 5,816 / `sm` 5,080 / `gap_peripheral` 5,062 / `host_input` 4,502 / `gatt` 4,294 |
| **角色/API/Profile** | 50,184 | **23.8%** | `ctl_input` 15,542 / `gattservapp` 10,948 / `gapbondmgr` 9,498 / `api_c` 6,638 |
| **RF/PHY** | 18,971 | **9.0%** | `rf_fh` 7,879 / `rfend` 4,544 / `ip` 4,026 / `aes` 1,304 / `lle` 666 / `bb` 552 / `aes_soft` **0** |
| **TMOS** | 8,312 | **3.9%** | `tmos` 4,298 / `tmos_snv` 1,840 / `tmos_hw` 916 / `memory` 738 / `message` 520 |

**解读**：

- 「协议行为」占 87%（LL+HOST+角色），**全部由 BT Core 规范与公开头文件定义**，可独立重写、可验证。
- RF/PHY 只占 **9.0%**，但 `aes_soft.o` 为 0 字节 + `aes.o` 仅 1.3 KB → **AES 走硬件引擎**（CH582 有片上 AES，寄存器未公开）。
- `rfend.o` 4.5 KB（占全库 2.2%）是**校准/调谐**集中地，也是唯一「不可能从规范推导」的部分。

### 4.4 符号分类（A/B/C/D）

先给导出面计数（`nm -g`，唯一定义符号）：

| 前缀 | 数量 | 性质 |
|---|---|---|
| `LL_` | 214 | 公开 LL API（`LL_Init`、`LL_AdvertiseEnalbe`、`LL_EncReq/Rsp`、`LL_FeatureReq`、`LL_PHYReq`、`LL_ChannelMapInd`…） |
| `ll_` | 87 | 内部实现（`ll_advertise_*`、`ll_scan_*`、`ll_connect_*`、`ll_hop`…），导出可见 |
| `BLE_` | 13 | `BLE_LibInit`、`BLE_IPCoreInit`、`BLE_RegInit`、`BLE_ReadRssi`、`BLE_ReadCfo`、`BLE_SetPHYTxMode/RxMode`、`BLE_CheckChannel`、`BLE_AccessAddressGenerate`… |
| `RF_` | 16 | `RF_RoleInit`、`RF_Config`、`RF_Tx/Rx`、`RF_SetChannel/Frequency`、`RF_FrequencyHopping*`、`RF_TxProcess`… |
| `RFEND_` | 12 | **校准/调谐全套**（下） |
| `API_` / `HCI_` / `ATT_` / `GATT*` / `GAP*` / `SM_` / `L2CAP*` / `TMOS*` | 118 / 111 / 81 / 67 / 102 / 14 / 26 / 12 | host 侧 |

分类：

| 类 | 定义 | 代表符号 | 数量（估计） | 重写依据 |
|---|---|---|---|---|
| **A 有公开依据（接口/行为）** | 语义由公开头文件 + BT Core 规范定义，无需看实现 | `LL_*`（214）、`API_LE_*`（118）、`ATT_*`(81)/`GATT*`(67)/`GAP*`(102)/`L2CAP*`(26)/`SM_*`(14)、`BLE_LibInit` | **600+**（含导出但非公开的内部处理函数，故不可简单相加） | 公开头文件 + Core Spec（见下方附注） |
| **B 可从规范重建（时序/状态机）** | 协议行为确定，但芯片时间基准/中断模型需适配 | `ll_*` 协议族（87）、`RF_TxProcess`、`LLE/BB` 中断入口 | ~90 | Core Spec + 黑盒互通测试 |
| **C 需黑盒观测（芯片相关）** | 无文档，只能「写值—看现象」 | `BB_*`、`LLE_DevInit`、`ip.o`（中断处理）、`RF_DevSetChannel`、`RF_HopGetChannel` | ~30 | 黑盒测量（规格组）+ 公开 API 面 |
| **D 校准类（最敏感）** | 工厂/温度校准算法，规范里不存在 | `RFEND_DevInit`、`RFEND_Reset`、`RFEND_SetSensitivity`、`RFEND_GetDACREF_TUNE`、`RFEND_SetDACREF_TUNE`、`RFEND_TXCtune`、`RFEND_TXCtuneGet`、`RFEND_TXCtuneSet`、`RFEND_TXFtune`、`RFEND_RXAdc`、`RFEND_RXFilter`、`RFEND_WaitTune`（**12 个**） | 12 | 只能自建表征，或向 WCH 索取文档 |

**关键证据（校准不可推导）**：`bleConfig_t` 公开字段 `pfnTempSampleCB tsCB; // Register a program that read the current temperature,**determine whether calibration is need**` —— 公开头文件自己承认**校准与温度相关且由库内部决策**，但算法、门限、寄存器序列全在 `rfend.o` 内。

### 4.5 RF 黑盒占比：三个口径

| 口径 | 数值 | 含义 |
|---|---|---|
| **代码量** | 18,971 / 210,602 = **9.0%** | RF/PHY 层代码占比；其中 `rfend` 4,544 B = **2.2%** 是校准 |
| **导出符号** | 28 / 255 = **11.0%** | `RF_`(16) + `RFEND_`(12) 占 `LL_`+`BLE_`+`RF_`+`RFEND_` 导出面的比例；其中校准 12 个 = **4.7%** |
| **工程关键路径** | **100% 阻塞** | 其余 91% 可按规范重写并独立验证；剩下 9% 若拿不到 RF/BB 文档，整栈无法上真机——不是「9% 的工作量」，是「9% 的门票」 |

**结论一句话**：**黑盒依赖在代码量上只有 9%，但在交付上是一票否决项。**

### 4.6 CH582 侧的具体缺口（M19 必须逐项关闭）

| # | 缺口 | 证据 | 影响 |
|---|---|---|---|
| G1 | RF/BB/LLE 寄存器映射 | 公开头文件零定义；EVT 无 RF 驱动 | 无法写 `ble_phy`/LLL 的收发原语 |
| G2 | 硬件 AES 寄存器 | `aes_soft.o` 为 0 字节，`aes.o` 1.3 KB | 可先软实现 AES-CCM（32KB SRAM/60MHz 下可行），非阻塞但需实测吞吐 |
| G3 | 32K 时钟域归属 | BLE 库独占 RTC/32K（M13–M17 已实证：`SelRTCClock` 错配导致连接必败） | 重写栈必须接管 32K 定时，与 HAL `enable_lse` 协调 |
| G4 | 免表中断/向量位置 | RTOS readme：「蓝牙中断为库内中断函数，使用了免表中断方式」「StartUP.S 已把 BB_IRQLibHandler 和 LLE_IRQLibHandler 放入中断向量表」 | 自研栈需要自己的中断接线方案（PFIC 可做，但需实测时延） |
| G5 | 校准数据来源 | `tsCB` + InfoFlash（24 KB，chip.json 注⑤）疑似存工厂校准 | 若校准值在 InfoFlash 的未公开布局中，重写必须能解析或重建 |
| G6 | CFO/RSSI/灵敏度 | `BLE_ReadCfo`、`BLE_ReadRssi`、`RFEND_SetSensitivity` | 影响连接稳定性与认证指标；黑盒可测但耗时 |

---

## 5. clean-room 隔离流程

> 目标：让「独立创作」在**技术上可举证**，而不是只靠声明。

### 5.1 角色

| 角色 | 职责 | 硬规则 |
|---|---|---|
| **规格组（dirty room）** | 读公开材料、做黑盒观测、写规格 | 可以看反编译（如经法务批准）；**不得写实现代码**；产出物必须过「表达过滤」 |
| **实现组（clean room）** | 只读规格 + 公开规范，写 Rust | **不得接触**：blob 反汇编/反编译输出、`strings` 清单、符号表、任何「像源码」的中间产物；不得与规格组共享聊天/文档 |
| **法务/合规** | 批准材料分级、审规格、留档 | 对每次「材料升级」签字 |
| **审计（可由法务兼）** | 抽查提交与规格的相似度、维护留痕 | 每里程碑一次 |

人员隔离要求：规格组与实现组**不得为同一人**；两组不共享即时通讯频道；实现组的代码仓库从空历史初始化（不 import 任何含 blob 派生物的历史）。

### 5.2 材料分级与接触矩阵

| 级 | 材料 | 规格组 | 实现组 | 备注 |
|---|---|---|---|---|
| **T0 公开规范** | BT Core Spec（LL/L2CAP/ATT/GATT/SM）、公开头文件 `CH58xBLE_LIB.h`、芯片 DS 的电气/引脚章节、SIG Assigned Numbers | ✅ | ✅ | 实现组的唯一「外部真相」 |
| **T0' 公开事实** | `nm`/`size`/`ar t` 的**统计量**（对象数、字节数、符号前缀计数） | ✅ | ✅（仅统计量） | 用于估算，不含函数级语义 |
| **T1 黑盒观测** | 空口抓包、逻辑分析仪、DTM 测量、寄存器「写值—看现象」记录 | ✅ | ⚠ 仅结论（不含方法细节） | 记录格式：现象 + 输入 + 结论，不贴反汇编 |
| **T2 二进制分析** | 反汇编、反编译、`strings` 全文、符号级调用图 | ⚠ 法务批准 + 隔离区 | ❌ **绝对禁止** | 产物存放在独立加密目录，不进 git |
| **T3 源码级重建** | 由反编译「翻译」出的伪代码/C 片段 | ❌ **禁止** | ❌ 禁止 | 一旦产生即视为污染，整段作废 |

### 5.3 规格文档写法（防「表达污染」）

每条规格断言必须带来源标签，且**禁止逐字摘抄**：

| 标签 | 含义 | 允许的写法 |
|---|---|---|
| `[SPEC]` | BT Core 规范条款号 | 「LL 广播事件在 advDelay 后开始（Spec Vol 6, Part B §4.4.x）」 |
| `[HDR]` | 公开头文件 | 「`LL_AdvGetCore(handle)` 返回 core 指针，参数为连接/广播句柄」——**接口签名可引用，注释文字不可整段复制** |
| `[OBS]` | 黑盒观测 | 「在 1M PHY、channel 37 上抓包，间隔 100 ms 时观察到 3 次重传」 |
| `[RE]` | 二进制分析（仅规格组内部） | 「`ll_hop` 使用 CSA#1 的 perm 表」——**只能写行为结论，不得附反汇编** |
| `[DS]` | 数据手册 | 「PA 输出功率档位见 DS 表 x」 |

硬规则：
1. 手册（§2.1(b)）与头文件注释**不得成段复制**；引用接口签名需标注 `[HDR]` 且仅限签名。
2. 规格中不得出现与原实现同名的**内部函数名**（`ll_*` 小写系列）；公开 API 名（`LL_*`、`GAP_*`）属接口事实，可用。
3. 规格只描述「输入/输出/时序/错误码」，不描述「代码结构、循环形态、数据结构布局」。
4. 每条断言必须有可复现的验证方式（抓包/DTM/单元测试），否则不得进入规格。

### 5.4 留痕清单（M19 启动即建，随里程碑更新）

1. **材料获取记录**：EVT 包下载 URL/日期/校验和；DS 获取记录；SIG 规范版本。
2. **人员名单与角色**：规格组/实现组实名，签署隔离承诺书。
3. **接触日志**：谁在何时访问了 T1/T2 材料（含审批单号）。
4. **规格变更史**：每条断言的来源标签 + 作者 + 日期 + 验证证据链接。
5. **实现提交史**：从空仓库初始化的首个 commit；每个 PR 声明「未接触 T2/T3」。
6. **相似度抽检报告**：每里程碑对比「实现代码 vs 反编译输出」的函数名/字符串/结构相似度（只比对，不引入）。
7. **污染事件记录**：发现即记录、隔离、作废、重写。
8. **法务意见书**：启动前一份（许可/风险）、发布前一份（合规结论）。
9. **第三方代码清单**：NimBLE/Zephyr 组件 + 版本 + 许可 + 修改说明（Apache-2.0 需保留 NOTICE）。
10. **BQB 相关记录**：QDID、测试报告、DTM 固件版本。
11. **对外文档审计**：README/博客/演讲中不得出现反编译截图或「逆向」表述。
12. **退出记录**：项目终止/合并时的材料销毁与归档。

### 5.5 污染事件处置（预设流程）

1. **发现**：任何实现组成员看到 T2/T3 材料 → 立即停止该模块工作。
2. **隔离**：该成员接触过的模块标记 `CONTAMINATED`，冻结提交。
3. **评估**：法务 + 审计判定污染范围（函数级/文件级）。
4. **作废重写**：由未接触的成员从规格重写；重写过程留录屏/日志。
5. **记录**：写入留痕清单第 7 项，随里程碑报告披露。
6. **预防**：复盘材料分发路径，补规则。

### 5.6 发布前审计 gate（上游 PR / 商业发布）

- [ ] 规格文档无逐字摘抄（抽检 20 条断言）
- [ ] 实现代码与反编译输出的相似度报告（函数名/字符串/常量表）
- [ ] 第三方组件许可清单齐全（Apache-2.0 NOTICE 保留）
- [ ] WCH 书面许可（blob 再分发）或已改为「官方下载」
- [ ] 律师意见书（著作权 + 合同 + 商业秘密）
- [ ] SIG 会员/BQB 状态确认

---

## 6. 路线图 M19+（分解与估算）

> 前提假设：目标 = **单芯片 CH582/583，BLE 5.0，peripheral + central 基本角色，1M PHY，legacy + 扩展广播，加密连接，MTU 可协商到 247**；不含 ISO/AoA/2M 首发。人力按 2–3 人（1 规格 + 1–2 实现）+ 0.2 法务。

### 6.1 分段表

| 里程碑 | 内容 | 方案 A（spec-first） | 方案 B（NimBLE 基座） | 退出门禁 | 依赖 |
|---|---|---|---|---|---|
| **M19 基建** | clean-room 协议、材料分级、规格模板、空口抓包/DTM 测量台、法务意见 | 0.5–1.0 | 0.5–1.0 | 留痕清单 1–3 项建立；测量台能抓 adv/conn | 无 |
| **M20 调度与内存** | TMOS 等价物（task/event/message/定时器 625 µs 基准）、堆/池、时间基准 | 1.0–1.5 | 1.0–1.5 | 事件调度单测 + 与 32K 域对齐（±50 ppm） | G3 |
| **M21 LL-adv/scan** | legacy adv（ADV_IND/NONCONN/SCAN）、scan（passive/active）、白名单、RPA 生成 | 3.0–4.0 | 2.0–2.5（复用 NimBLE） | 手机/bluez 可发现、可扫描、RSSI 合理 | G1、G4 |
| **M22 LL-conn** | 连接建立（CONNECT_IND）、锚点/窗口、CSA#1/#2 跳频、SN/ACK、流控、加密启动（AES-CCM）、PHY 更新（可选） | 3.5–4.5 | 2.0–3.0 | 连接稳定 ≥30 min、丢包 <1%、密文互通 | G1、G2、G4 |
| **M23 L2CAP/ATT/GATT** | 分片重组、ATT 全命令、GATT server/client、CCCD、MTU 交换、服务发现 | 3.5–4.5 | 2.0–3.5（移植 NimBLE host 则更低） | GATT 读写/notify 全通（对照 bluez/手机） | M22 |
| **M24 SM** | legacy pairing、LE Secure Connections（P-256 ECDH）、CTKD、绑定存储 | 3.0–4.0 | 1.0–1.5 | 与 3 种手机配对/重连成功 | M22 |
| **M25 RF 驱动/校准** | CH582 RF/BB 收发原语、通道/频率/白化/CRC、TX 功率档、RSSI/CFO、温补与校准、DTM | 4.0–8.0 | 4.0–8.0 | 灵敏度/功率达标（DS 指标内）；-40~85℃ 连接不丢 | **G1、G5（阻塞）** |
| **M26 集成与实测** | 实机矩阵、功耗、互操作、回归 | 2.0–3.0 | 2.0–3.0 | 矩阵通过 + 功耗基线 | 全部 |
| **合计** | | **20.5–30.5** | **13.5–22.5** | | |

> 取整表述：**A = 20–30 人月；B = 13–22 人月（中位 ~16）**。B 相对 A 省 7–8 人月，省在 LL 状态机与 SM；**M25 完全不可压缩**。

### 6.2 关键路径

```
M19 ──> M25(G1/G5 关闭) ──┬─> M21 ──> M22 ──> M23 ──> M26
        │                 └─> M24 ────────────────┘
        └─> M20 ─────────────────────┘
```

- **M25 是唯一真关键路径**：G1（寄存器）与 G5（校准数据）不关闭，M21/M22 只能跑在「模拟射频」上，无法上真机。
- M20/M23/M24 可与 M25 并行（用规格 + 单元测试 + 抓包回放）。
- 建议 M19 先用 2–4 周做「G1 可行性探针」：只回答一个问题——**不反编译的前提下，能否通过公开渠道/NDA 拿到 RF 寄存器与校准布局**。答案为否 → 整个 M19+ 应终止，继续 blob 路线。

### 6.3 两方案对比（决策视角）

| 维度 | 方案 A（spec-first） | 方案 B（NimBLE 基座） |
|---|---|---|
| 工作量 | 20–30 人月 | 13–22 人月 |
| 许可洁净度 | 最高（全自研） | 高（Apache-2.0，需留 NOTICE） |
| 「独立创作」举证 | 最强 | 强（复用第三方代码，但第三方本身清白） |
| 时间到首个可连接固件 | 8–12 人月 | 5–7 人月 |
| 代码可控性/可读性 | 最高（Rust 原生） | 中（C 控制器 + Rust 胶水/FFI，或 C→Rust 重写） |
| 风险 | 协议细节踩坑多 | 第三方代码与 CH582 硬件模型不匹配 |
| 建议 | 若「必须全 Rust 且要上游开源」→ A | 若「尽快摆脱 blob」→ **B** |

### 6.4 BQB / 射频一致性（另计）

- **性质**：产品级认证，不是代码级；需 DTM（Direct Test Mode）固件 + 射频测试夹具 + 认可实验室。
- **工作量**：3–6 人月工程（DTM 实现、测试模式稳定、问题整改）+ 外部测试周期（通常 4–8 周）。
- **前置**：M25 完成（RF 指标可测）；SIG 会员与 QDID 声明。
- **费用**：SIG 会员年费 + QDID 声明费 + 实验室测试费，**本报告不引用具体金额（未核实，勿作预算依据）**。
- **注意**：blob 路线下这些由 WCH 的既有认证覆盖（产品用 WCH 栈通常可引用其 QDID）；**自研栈一旦替换，认证责任回到自己**——这是除工作量外最容易被低估的成本。

---

## 7. 结论与建议

### 7.1 结论

1. **法律上可行，但不是「随便做」**：无禁逆向条款，「限芯片」句不阻碍在 CH582 上重写；真正的约束来自①著作权的表达保护（禁止抄代码/抄手册）②合同上的使用范围③SIG 的 SEP/认证体系。
2. **技术上可行，但被 RF 文档卡住**：91% 的代码可按公开规范独立重写；剩下 9%（RF/PHY，含 2.2% 校准）在**没有 CH583 RF 寄存器与校准布局**的前提下无法上真机。
3. **开源基座明确**：NimBLE（Apache-2.0）是唯一同时满足「许可干净 + LL 完整 + 移植面小 + 维护活跃」的候选；Zephyr 可作备选；BTstack、NuttX、nrf-softdevice、BlueZ、ESP-IDF 均排除。
4. **工作量量级**：13–22 人月（推荐方案 B），另加 3–6 人月认证工程 + 外部费用；不是「一个里程碑」，是「一个产品线分支」。
5. **本期维持 blob 路线是正确的**：现有栈已实机闭环（M17），重写的边际收益是「许可自主 + 可调试性」，边际成本是 1.5–2 人年 + 认证风险。

### 7.2 上游 PR 重启条件（四条硬条件 + 两条软条件）

**硬条件（缺一不可）**
- **C1 重写完成**：至少 LL-adv/scan/conn + ATT/GATT + SM 在 CH582 上实机跑通，且不链接 WCH blob。
- **C2 实机矩阵**：≥3 种主机（Android/iOS/Linux bluez）+ ≥2 颗芯片（CH582M/CH583M）+ 温漂/长时间稳定性记录。
- **C3 许可清理**：①WCH 书面许可（或确认不再主张）覆盖 blob 再分发与派生；②确认 §2.4 的 TI 权利链问题；③第三方组件 NOTICE 完整。
- **C4 clean-room 证据链**：留痕清单 1–8 项齐备 + 相似度抽检报告 + 律师意见书。

**软条件**
- **S1** BQB/射频一致性已启动或已完成（否则 PR 里的「可用」无法被下游采信）。
- **S2** 维护承诺：至少 1 名长期维护者 + CI（编译 + 抓包回放测试）。

**当前裁决不变**：以上条件均未满足 → **不开 upstream issue/PR**。

### 7.3 需要用户裁决的三件事（M18 之后）

1. **是否向 WCH 正式索取 RF/BB 寄存器文档与校准说明（可签 NDA）？** —— 这是 M19+ 的**唯一硬阻塞**；不解决则不建议立项。
2. **是否评估 Bluetooth SIG 会员 + BQB 路径？** —— 决定自研栈能否商业化，也决定上游 PR 的形态（代码 vs 产品）。
3. **是否投入 2–3 人 × 12–18 个月？** —— 若否，则本报告归档，M19+ 不启动，blob 路线长期化（并把 R1 缓释做到位：README 声明 + 许可澄清）。

### 7.4 本期不变更项（明确重申）

- `vendor-src/ch5xx-ble/vendor/LIBCH58xBLE.a` 保持原样，不改、不 patch、不剥离。
- 不新增任何 reverse-engineering 工具/脚本进仓库。
- 不提交 upstream issue/PR，不 fork。
- 本文件为唯一新增产物。

---

## 附录 A：证据命令与原始输出摘要（只读，可复现）

```bash
# 1) 头文件条款
sed -n '1,9p' /home/teze/CH32/EVT/CH583EVT/EVT/EXAM/BLE/LIB/CH58xBLE_LIB.h
grep -rl "Attention: This software" --include=*.h /home/teze/CH32/EVT/CH583EVT/EVT | wc -l   # 106

# 2) 手册免责声明（末页）
pdftotext "/home/teze/CH32/EVT/CH583EVT/EVT/EXAM/BLE/<GBK名>.PDF" - | grep -n -A8 "版本声明与免责声明"

# 3) OTA PDF 无限制声明
pdftotext "/home/teze/CH32/EVT/CH583EVT/EVT/EXAM/BLE/<GBK名>.PDF" - | grep -E "版权|声明|限制|禁止|许可|所有权|未经"   # 0 命中

# 4) blob 元数据
ar t        vendor-src/ch5xx-ble/vendor/LIBCH58xBLE.a | wc -l          # 67
size -t     vendor-src/ch5xx-ble/vendor/LIBCH58xBLE.a | tail -1        # 210602 271 290
readelf -S  vendor-src/ch5xx-ble/vendor/LIBCH58xBLE.a | grep -c debug_ # 0
nm -g --defined-only ... | awk 'NF==3{print $3}' | sort -u | wc -l     # 1387
strings -a ... | grep -E "GCC:"                                        # xPack 8.2.0

# 5) RF 公开度
grep -rn -E "R8_(BLE|RF|BB|LLE)|RFCTRL" --include=*.h /home/teze/CH32/EVT/CH583EVT/EVT/EXAM/SRC   # 0 命中

# 6) 开源 LL
wc -l /home/teze/zephyrproject/zephyr/subsys/bluetooth/controller/{ll_sw/*.c,ticker/*.c} 
wc -l /tmp/m18-nimble/nimble/controller/src/*.c      # 39771
wc -l /tmp/m18-rubble/rubble/src/**/*.rs             # 11276
```

> 注：`<GBK名>` 指 `EVT/EXAM/BLE/` 下两个文件名已损坏（双编码）的 PDF：`WCH…（BLE OTA）.PDF` 与 `沁恒低功耗蓝牙软件开发参考手册v1.9.PDF`；`pdfinfo` 可读出标题，`pdftotext` 可正常提取正文。

## 附录 B：未决问题（Q）

| ID | 问题 | 影响 | 关闭方式 |
|---|---|---|---|
| Q1 | CH583DS1/RM 是否含 RF/PHY 寄存器表？ | 决定 M25 是否可做 | 取得 DS/RM 原文（官网 SPA 需人工下载） |
| Q2 | 官网是否另附 SDK/库许可协议？ | 影响 R1/R4 | 人工浏览下载页并留存 PDF/截图 |
| Q3 | 校准数据是否存于 24KB InfoFlash？布局是否可读？ | 决定 G5 | 只读 dump + 与 DTM 指标比对（规格组） |
| Q4 | CH582 硬件 AES 寄存器是否在任何公开资料出现？ | 决定 G2 走软实现还是硬实现 | 同上 |
| Q5 | WCH 库是否确由 TI BLE-CC254x 派生？ | 影响权利链与 PR 可行性 | 公开 API 比对 + 向 WCH 发函 |
| Q6 | 《反不正当竞争法》2025 修订后商业秘密条款条号 | 影响 L5 引用准确性 | 外发前按现行文本核对 |
| Q7 | SIG 会员/声明/测试的实际费用 | 影响商业决策 | 向 SIG 询价 |

## 附录 C：术语

| 术语 | 含义 |
|---|---|
| ULL / LLL | Upper/Lower Link Layer：协议状态机层 / 无线电中断层 |
| LLCP | Link Layer Control Procedure（连接参数更新、加密启动、PHY 更新等） |
| CSA#1 / #2 | Channel Selection Algorithm #1/#2（跳频算法） |
| AA / CRCInit | Access Address / CRC 初值（每个连接不同） |
| DTM | Direct Test Mode（射频认证测试模式） |
| BQB / QDID | Bluetooth Qualification Body 认证 / 声明 ID |
| SEP | 标准必要专利 |
| field-of-use | 使用领域/范围限制（如「仅用于某厂商芯片」） |
| clean room | 规格与实现人员/材料隔离的开发方法 |
| T0–T3 | 本文的材料分级（公开→二进制→源码级重建） |

---

**报告结束。** 本文件为 M18-S5 唯一交付物；未修改任何其它文件，未执行任何重写实现，未开上游 issue/PR，未 fork。本期 vendored blob 路线不变。