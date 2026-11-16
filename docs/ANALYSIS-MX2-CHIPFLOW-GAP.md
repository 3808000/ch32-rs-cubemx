# MX2 实机「选芯片 → 创建工程 → 生成代码」链路取证与对比（M9 依据）

> 取证方式：CDP 真实输入事件操作本机 STM32CubeMX2 v1.1.1（2026-11-16）。
> 截图证据：/tmp/mx2-mcu-selector.png（第一步）、/tmp/mx2-step2.png（第二步）、/tmp/mx2-c542-setup.png（第三步 0% 网络陷阱）、/tmp/mx2-ready.png（Project Ready）、/tmp/mx2-niubi-settings.png（设置页 + 生成完成 toast）。
> 生成产物实证：/home/teze/CLionProjects/NIUBI_cmake/（CMakeLists.txt / main.c / generated/ / stm32c5xx_drivers/ / user_modifiable/ …）。

## 1. MX2 链路实录

### 1.1 入口
Home「MCU / Create project」卡 → 模态向导 **「Create Application Project from MCU」**，三步 stepper：
**1 Select MCU → 2 Project Details → 3 Setup in Progress**。

### 1.2 第一步 Select MCU
- 全局搜索框：`Search by part no, core, package...`
- 表格列（**均可排序**，表头排序箭头）：MCU name / Series / Line / Package / Freq (MHz) / RAM (kB) / Flash (kB) / Cores
- **逐列过滤行**：每列一个 Search 输入 + 漏斗图标
- 工具：**Columns**（列可见性菜单）、**Export list**（导出芯片清单）
- 行点击 = 选中（底部 `Selected: N line(s)`），**Continue 门禁**（未选禁用）
- 分页：Rows per page（5/…）+ `1-5 of 514` + 前后翻页
- 外链 STM32 MCU Portfolio（选型辅助）
- footer：Previous step（禁用）/ Cancel / Continue

### 1.3 第二步 Project Details
- **Project name** 输入（必填门禁：空则 Create project 禁用），后缀 `.ioc2` 提示
- **Project location** 输入（可编辑）+ Change 按钮
- **Project file path (Auto-generated)** 只读联动：`<location>/<name>.ioc2`
- **Selected MCU: <型号>** 回显
- footer：Previous step / Cancel / **Create project**
- 用户确认：名称与路径在创建时输入，**此后设置页只读**（见 1.5）

### 1.4 第三步 Setup in Progress
- 文案明示：**需要联网**安装 toolchains/frameworks/SDKs；进度百分比 + Processing…
- 网络被阻断时**卡 0% 且 Previous/Launch 全禁用**（陷阱态，仅右上角 × 可逃）；换芯片（依赖已装）同样卡 0% → setup 强制联网校验，与本地缓存无关
- 代理恢复后完成 → **Project Ready / Project Successfully Created** → **Launch Project** → 开 Pinout 标签
- 对比结论：**MX2 创建链路强依赖网络；本工具纯本地秒建，是核心差异化优势**（保持，不模仿联网 setup）

### 1.5 生成代码
- 入口二：左栏**黄色生成快捷图标** / Project settings → IDE Project Generation → **Generate IDE project**（段末黄按钮）
- 生成期间设置页**全部输入禁用**（防改配置）
- 完成 = **右下角 Info toast**：`CMake project generation completed for <name>.` + **Show on disk** 按钮；**无模态报告**
- 设置页 General 的 Project Folder Name / Project path **只读**（创建时已定）
- Destination 默认 `<name>_cmake`（相对工程目录），可编辑 + 文件夹选择

## 2. 本工具现状（M8 末）与差距

| 环节 | MX2 | 本工具现状 | 差距/决策 |
|---|---|---|---|
| 选型搜索 | 全局搜索 + 逐列过滤 | 单搜索框（名/封装/内核） | **补逐列过滤** |
| 排序 | 全列可排序 | 固定芯片名序 | **补表头排序** |
| 列管理/导出 | Columns 菜单 + Export list | 无 | **补两者**（CSV） |
| 分页 | Rows per page + 总数 | 无（4 芯片全列） | **补分页**（面向未来多芯片） |
| 选中→继续 | 行选中 + Selected 计数 + Continue 门禁 | 行点击立即建工程 | **改两段式**：选中→Continue→详情 |
| 创建详情 | name 必填 + location + 自动路径 + MCU 回显 | 无（默认名 ch32-project 直接建） | **补第二步向导**（name 必填门禁 + 存储位置预览 + MCU 回显） |
| 名称/路径归属 | 创建时定，设置页只读 | 设置页可改名 | **设置页改只读 + 提示**（改名走工程库 rename） |
| setup | 联网装依赖（陷阱态） | 纯本地秒建 | **保持本地**（差异化，文档明示） |
| 生成完成 | toast + Show on disk | 页内 GenerationReport（更丰富） | **保持页内报告**（优势） |
| 生成期间防改 | 输入禁用 | generating/writingFolder 已禁用按钮 | 补齐：生成期间设置页选项禁用（已有 loading 门禁，核对） |

## 3. M9 任务（本轮实施）

- **9.1 ChipPicker 升级**：行选中模型 + Selected 计数 + Continue 门禁；表头排序；逐列过滤行；分页 + Rows per page；Columns 菜单；Export list（CSV）。纯函数导出供测试。
- **9.2 两步创建向导** `CreateProjectWizard.vue`：stepper（1 Select MCU / 2 Project Details）；第二步 name 必填门禁 + 存储位置只读预览（浏览器 localStorage 槽位，诚实标注；桌面磁盘工程库落地后换真实路径）+ Selected MCU 回显 + Previous/Cancel/Create project；Create → setProjectName + switchDevice + Pinout + notify。Home MCU 卡入口改开向导。
- **9.3 设置页 General 只读化**：Project name / 存储位置只读展示 + 「创建工程时设定；改名请用工程库重命名」提示；移除可编辑 name 输入（commitProjectName 相应清理）。
- **9.4 验收**：浏览器走 Home→向导→选型→详情→创建→Pinout→设置只读→生成 全链路；纯函数测试 ≥20；全量门禁 + verify:build。

明确不做：联网 setup（差异化）、toast 替代页内报告（优势）、Portfolio 外链（无对应数据）。