<script setup lang="ts">
// Project settings 主视图（M2.4）：General / Runtime / Code Generation / Advanced 可折叠面板。
// General（M9）只读展示工程名/存储位置与芯片、target、toolchain、HAL rev（名称与位置在创建向导中设定）；
// Runtime（M6）选择 blocking/embassy 运行时与调试打印（rtic 待 HAL 支持，禁激活）；
// Code Generation（M7）为唯一生成决议中心：子项/档位/IDE/导出方式/检查确认/预览决议/结果报告全在页内（对齐 CubeMX2，无二次弹窗）；
// Generation 说明导出选项并打开 CodegenDialog（与 Pinout 共用同一生成服务）；
// Advanced 展示 M1 再生成安全网的 fileGroup 策略、M8 类别级冲突策略（Automatic Conflict Handling Rules）
// 与冲突决议选项。
import { computed, reactive } from 'vue'
import { Expand, Fold, FolderOpened, Menu, Promotion } from '@element-plus/icons-vue'
import type { BleConfig, ConflictPolicyMode, ConflictResolution, FileGroup } from '@/model/types'
import { useProjectStore } from '@/controllers/project'
import { HAL_GIT, CH58X_HAL_GIT, CH58X_HAL_REV } from '@/model/codegen/halRev'
import { CH5XX_HAL_GIT, CH5XX_HAL_REV } from '@/model/codegen/ch5xx'
import { BLE_NAME_BUDGET } from '@/model/conflicts/rules/bleRules'
import { storagePreview, wizardIsDesktop } from '@/components/home/CreateProjectWizard.vue'
import CollapsiblePanel from '@/components/common/CollapsiblePanel.vue'
import PreflightPanel from '@/components/codegen/PreflightPanel.vue'
import ExportPlanPreview from '@/components/codegen/ExportPlanPreview.vue'
import ConflictRules from '@/components/codegen/ConflictRules.vue'
import GenerationReport from '@/components/codegen/GenerationReport.vue'
import { useGenerationFlow, generationItemsFor } from '@/components/codegen/useGenerationFlow'

const store = useProjectStore()

// ---- General（M9：名称与存储位置创建时设定，此处只读） ----
const chip = computed(() => store.deviceData.chip)
/** M17：生效 HAL 后端（工程覆盖 > 历史 legacy > chip 默认），设置页一切后端相关文案以它为准。 */
const backend = computed(() => store.effectiveHalBackend)
const isCh5xx = computed(() => backend.value === 'ch5xx-hal')
/** legacy ch58x 后端被选中（仅 CH582 等声明 legacyHalBackend 的芯片可能为 true）。 */
const isCh58x = computed(() => backend.value === 'ch58x-hal')
/** 芯片是否有 BLE 能力（CH58x 家族）：与当前选择的后端无关，BLE 节可见性使用。 */
const supportsBle = computed(() => !!chip.value.legacyHalBackend || (chip.value.halBackend ?? '') === 'ch58x-hal')
const toolchain = computed(() => {
  // ch5xx：nightly + rust-src（[unstable] build-std=core，三档一致）
  if (isCh5xx.value) return 'nightly + rust-src（build-std=core）'
  // legacy ch58x：embassy 档 nightly；blocking/BLE busy-poll 档 stable
  if (isCh58x.value) return bleEnabled.value ? 'stable' : runtime.value === 'embassy' ? 'nightly' : 'stable'
  return chip.value.nightly ? 'nightly + rust-src' : 'stable'
})
/** HAL rev 显示后端感知：ch5xx/ch58x 工程生成物用各自 HAL 的 rev（config.hal.rev 是 ch32 口径）。 */
const effectiveHalRev = computed(() =>
  isCh5xx.value ? CH5XX_HAL_REV : isCh58x.value ? CH58X_HAL_REV : store.halRev,
)
const halRevShort = computed(() => effectiveHalRev.value.slice(0, 12))
const halRevUrl = computed(() => {
  const git = isCh5xx.value ? CH5XX_HAL_GIT : isCh58x.value ? CH58X_HAL_GIT : HAL_GIT
  return `${git.replace(/\.git$/, '')}/commit/${effectiveHalRev.value}`
})
/** ch5xx 的芯片 feature 是 family 小写（ch582）；legacy 用 chip.json 的 halFeature。 */
const halFeatureLabel = computed(() => (isCh5xx.value ? chip.value.family.toLowerCase() : chip.value.halFeature))
const storage = computed(() => storagePreview(wizardIsDesktop(), store.projectName))

// ---- Runtime（M6：运行时一等公民） ----
// features.embassy 驱动生成器（main.rs / 外设 async API / DMA 冲突规则），此前无 UI 开关。
// rtic 在 ch32-hal 尚未支持：选项禁激活并诚实标注，不臆造生成路径。
type RuntimeKind = 'blocking' | 'embassy' | 'rtic'
const runtime = computed<RuntimeKind>(() => (store.features.embassy ? 'embassy' : 'blocking'))
const embassySupported = computed(() => !(chip.value.unsupportedFeatures ?? []).includes('embassy'))
/** ch5xx/ch58x 都属于 CH58x 家族后端：Runtime 面板显示额外能力边界标注。 */
const isCh58xFamily = computed(() => isCh5xx.value || isCh58x.value)

// ---- BLE（M12，仅 ch58x-hal 后端显示；数据驱动写 store.ble） ----
const BLE_GAP_NAME_MAX = 248
const bleEnabled = computed(() => store.features.ble)
const bleNameBytes = computed(() => new TextEncoder().encode(store.ble.deviceName ?? '').length)
const bleNameBudget = computed(() => BLE_NAME_BUDGET[store.ble.role])
const bleNameTooLong = computed(
  () => bleNameBytes.value > bleNameBudget.value || bleNameBytes.value > BLE_GAP_NAME_MAX,
)

function setRuntime(kind: RuntimeKind) {
  if (kind === 'rtic') return
  if (kind === 'embassy' && !embassySupported.value) return
  // BLE 互锁（M12/M13）：BLE 档使用 busy-poll 运行时，blocking/embassy 切换不影响 BLE 生成；
  // 仍禁止切回 blocking 以免 store 状态与生成物语义不一致（store 互锁 ble⇒embassy 保持不变）。
  if (kind === 'blocking' && bleEnabled.value) {
    store.notify('BLE 档使用 busy-poll 运行时：blocking/embassy 选择不影响 BLE 生成', 'warning')
    return
  }
  store.setFeatures({ embassy: kind === 'embassy' })
  store.notify(kind === 'embassy' ? '运行时已切换为 embassy（async）' : '运行时已切换为 blocking（阻塞）', 'info')
}

function setDebugPrint(v: boolean) {
  store.setFeatures({ debugPrint: v })
}

// ---- BLE（M12，仅 ch58x-hal 后端显示；数据驱动写 store.ble） ----
const bleRoleOptions: { value: BleConfig['role']; label: string; desc: string }[] = [
  { value: 'peripheral', label: 'peripheral', desc: '可连接从机：广播 + 简单 GATT 服务（read/notify + write）' },
  { value: 'broadcaster', label: 'broadcaster', desc: '只广播不连接：adv 短名 + 厂商数据 + 扫描响应完整名' },
  { value: 'observer', label: 'observer', desc: '只扫描不连接：打印对端地址/RSSI 并周期重扫' },
]

const bleMacSourceOptions: { value: BleConfig['macSource']; label: string; desc: string }[] = [
  { value: 'factory', label: '出厂 MAC（推荐）', desc: '读取 ISP ROM 中的唯一地址（ch5xx 经 libISP583 ROM 命令）' },
  { value: 'default', label: 'HAL 固定值', desc: '11:22:33:44:55:66（Config::default，仅调试用，多设备会撞址）' },
  { value: 'custom', label: '自定义', desc: '按人读序生成 MacAddress::from_msb' },
]

const bleRoleDesc = computed(() => bleRoleOptions.find((o) => o.value === store.ble.role)?.desc ?? '')
const bleMacSourceDesc = computed(
  () => bleMacSourceOptions.find((o) => o.value === store.ble.macSource)?.desc ?? '',
)

function setBleEnabled(v: boolean) {
  // 开启自动打开 embassy（setFeatures 内互锁兜底）；BLE 生成按 busy-poll 处理
  store.setFeatures({ ble: v, ...(v ? { embassy: true } : {}) })
  store.notify(
    v
      ? `BLE 已启用：使用 busy-poll 运行时${isCh5xx.value ? '（ch5xx-ble shim）' : '（legacy ch58x-hal）'}；32K 低频域缺省 LSE（外部 32.768kHz 晶振）`
      : 'BLE 已停用（运行时设置保持不变）',
    v ? 'warning' : 'info',
  )
}

/** M17：切换 HAL 后端（CH582 等有 legacy 的芯片）。 */
function setHalBackend(value: string) {
  store.setHalBackend(value)
  const label = value === chip.value.legacyHalBackend ? 'legacy' : '默认'
  store.notify(`HAL 后端已切换为 ${value}（${label}）`, 'info')
}

function setBleRole(role: BleConfig['role']) {
  store.setBle({ role })
}

function setBleName(name: string) {
  store.setBle({ deviceName: name })
}

function setAdvInterval(v: number | undefined) {
  if (typeof v === 'number' && Number.isFinite(v)) store.setBle({ advIntervalMs: v })
}

function setScanMs(v: number | undefined) {
  if (typeof v === 'number' && Number.isFinite(v)) store.setBle({ scanMs: v })
}

function setMacSource(source: BleConfig['macSource']) {
  store.setBle({ macSource: source })
}

function setCustomMac(mac: string) {
  store.setBle({ mac: mac })
}

function setActiveScan(v: boolean) {
  store.setBle({ activeScan: v })
}

/** M14：BLE 32K 时钟源（lse 缺省=enable_lse+SelRTCClock=0；lsi 回退=SelRTCClock=1） */
function setBleClock32k(v: 'lse' | 'lsi') {
  store.setBle({ clock32k: v })
}

/** UUID16 输入显示为 0xFFE0 风格；解析接受带/不带 0x 前缀的十六进制。 */
function fmtUuid(n: number): string {
  return `0x${(n & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`
}

function setUuid(field: 'serviceUuid16' | 'notifyUuid16' | 'writeUuid16', text: string) {
  const n = Number.parseInt(String(text).trim().replace(/^0x/i, ''), 16)
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    store.notify(`UUID16 非法：${text}（需 0x0000–0xFFFF）`, 'warning')
    return
  }
  const patch: Partial<BleConfig> =
    field === 'serviceUuid16'
      ? { serviceUuid16: n }
      : field === 'notifyUuid16'
        ? { notifyUuid16: n }
        : { writeUuid16: n }
  store.setBle(patch)
}

// ---- Generation（M7：一切生成决议在页内，对齐 CubeMX2，无二次弹窗） ----
const {
  selection,
  includeMain,
  generating,
  writingFolder,
  exportMode,
  folderTarget,
  canWriteFolder,
  folderHint,
  report,
  pendingFolder,
  resolutions,
  conflictEntries,
  checkReport,
  warnAcknowledged,
  pickFolder,
  exportConfigOnly,
  generate,
  confirmFolderWrite,
  cancelFolderPreview,
  finishReport,
} = useGenerationFlow()

// 子项文案随生效 HAL 后端变化（M11/M17：vendor/<hal> 目录名）
const generationItems = computed(() => generationItemsFor(backend.value))

/** HAL 后端下拉项（仅声明 legacyHalBackend 的芯片显示）：默认后端 + legacy。 */
const halBackendOptions = computed(() => {
  const out: { value: string; label: string }[] = []
  if (chip.value.halBackend) out.push({ value: chip.value.halBackend, label: `${chip.value.halBackend}（默认）` })
  if (chip.value.legacyHalBackend) out.push({ value: chip.value.legacyHalBackend, label: `${chip.value.legacyHalBackend}（legacy）` })
  return out
})

// ---- Advanced ----
const groupPolicies: { group: string; paths: string; policy: string }[] = [
  {
    group: 'generated',
    paths: 'src/generated/**',
    policy:
      '每次重新生成时重写；磁盘内容与上次生成记录一致时自动覆盖，用户手改过则进入冲突决议（默认跳过）；上次生成、本次不再生成的文件会被删除。',
  },
  {
    group: 'project_file',
    paths: 'Cargo.toml / .cargo / rust-toolchain / build.rs / README / cube.json',
    policy:
      '已存在默认保留；Cargo.toml 默认按标记区合并（只替换 # >>> ch32-cubemx generated >>> 区间），其它文件冲突默认跳过。',
  },
  {
    group: 'user_code',
    paths: 'src/main.rs（双核为各核 src/main.rs）',
    policy: '用户区永不覆盖；生成器不会修改你的应用代码。',
  },
  {
    group: 'pack',
    paths: 'vendor/ch32-hal/**',
    policy: '厂商 HAL 源码；已存在默认保留本地内容，可在冲突决议中显式覆盖或备份。',
  },
]

const resolutionOptions: { label: string; desc: string }[] = [
  { label: '跳过', desc: '保留磁盘现状（默认）' },
  { label: '覆盖', desc: '写入本次生成内容' },
  { label: '备份后覆盖', desc: '先写入 .bak，再覆盖' },
  { label: '标记区合并', desc: '仅 Cargo.toml 有效；其它文件按覆盖处理' },
]

// ---- Advanced · 类别级冲突策略（M8，对齐 CubeMX2 Automatic Conflict Handling Rules） ----
// master 三档：safe=安全网（conflict 默认跳过，M1 现状）；update=Update files on change
// （conflict 默认覆盖）；custom=逐组自定义（缺省组回退 safe）。user_code 硬保护不受策略影响。
const policyModeOptions: { value: ConflictPolicyMode; label: string }[] = [
  { value: 'safe', label: '默认安全网（冲突跳过）' },
  { value: 'update', label: 'Update files on change（变更时更新）' },
  { value: 'custom', label: 'Custom…（逐组自定义）' },
]

const policyGroupRows: { group: FileGroup; options: ConflictResolution[] }[] = [
  { group: 'generated', options: ['skip', 'overwrite', 'backup'] },
  { group: 'project_file', options: ['skip', 'overwrite', 'backup', 'base-merge'] },
  { group: 'pack', options: ['skip', 'overwrite', 'backup'] },
]

const policyRuleLabels: Record<ConflictResolution, string> = {
  skip: '跳过（skip）',
  overwrite: '覆盖（overwrite）',
  backup: '备份后覆盖（backup）',
  'base-merge': '标记区合并（base-merge，仅 Cargo.toml）',
}

/** 切换 master 档位；保留已选的逐组规则，切回 custom 时不丢配置。 */
function setPolicyMode(mode: ConflictPolicyMode) {
  store.setConflictPolicy({ ...store.conflictPolicy, mode })
}

/** custom 模式下某组的当前规则（缺省 = safe 的 skip）。 */
function policyGroupRule(group: FileGroup): ConflictResolution {
  return store.conflictPolicy.groups?.[group] ?? 'skip'
}

/** 设置某组规则（自动进入 custom 模式）。 */
function setPolicyGroupRule(group: FileGroup, value: ConflictResolution) {
  store.setConflictPolicy({
    mode: 'custom',
    groups: { ...store.conflictPolicy.groups, [group]: value },
  })
}

// ---- 章节展开 / 导航 ----
const open = reactive({ general: true, runtime: true, ble: true, generation: true, preview: true, result: true, advanced: true })

function expandAll() {
  open.general = true
  open.runtime = true
  open.ble = true
  open.generation = true
  open.preview = true
  open.result = true
  open.advanced = true
}

function collapseAll() {
  open.general = false
  open.runtime = false
  open.ble = false
  open.generation = false
  open.preview = false
  open.result = false
  open.advanced = false
}

function scrollTo(command: string | number | object) {
  const section = String(command)
  document.getElementById(`ps-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onGenerate() {
  void generate()
}
</script>

<template>
  <div class="project-settings">
    <!-- 页头 + 章节导航 -->
    <div class="ps-head">
      <div>
        <h1 class="page-title">Project settings</h1>
        <div class="page-sub">{{ chip.chip }} · {{ chip.package }} · {{ store.projectName }}</div>
      </div>
      <div class="ps-actions">
        <el-dropdown trigger="click" @command="scrollTo">
          <el-button size="small" :icon="Menu">Quick menu</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="general">General</el-dropdown-item>
              <el-dropdown-item command="runtime">Runtime</el-dropdown-item>
              <el-dropdown-item v-if="supportsBle" command="ble">BLE</el-dropdown-item>
              <el-dropdown-item command="generation">Code Generation</el-dropdown-item>
              <el-dropdown-item v-if="pendingFolder" command="preview">导出预览</el-dropdown-item>
              <el-dropdown-item v-if="report" command="result">生成结果</el-dropdown-item>
              <el-dropdown-item command="advanced">Advanced</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button size="small" :icon="Expand" @click="expandAll">Expand all</el-button>
        <el-button size="small" :icon="Fold" @click="collapseAll">Collapse all</el-button>
      </div>
    </div>

    <div class="ps-body">
      <!-- General -->
      <div id="ps-general" class="ps-section">
        <CollapsiblePanel v-model:open="open.general" title="General">
          <div class="ps-rows">
            <div class="ps-row">
              <div class="ps-label">Project name</div>
              <div class="ps-value">
                <code>{{ store.projectName }}</code>
                <span class="ps-note">名称与存储位置在创建工程时设定；改名请用工程库重命名</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">存储位置</div>
              <div class="ps-value ps-storage-value">
                <code>{{ storage.location }}</code>
                <span class="ps-note">{{ storage.note }}</span>
                <span class="ps-note">自动路径：<code>{{ storage.path }}</code></span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">Chip</div>
              <div class="ps-value"><code>{{ chip.chip }}</code></div>
            </div>
            <div class="ps-row">
              <div class="ps-label">Package</div>
              <div class="ps-value">{{ chip.package }} · {{ chip.pins.length }} pins</div>
            </div>
            <div class="ps-row">
              <div class="ps-label">Target triple</div>
              <div class="ps-value"><code>{{ chip.target }}</code></div>
            </div>
            <div class="ps-row">
              <div class="ps-label">Rust toolchain</div>
              <div class="ps-value">
                {{ toolchain }}
                <span class="ps-note">{{ isCh5xx ? 'nightly + rust-src：[unstable] build-std=["core"]（三档一致）' : isCh58x ? (bleEnabled ? 'BLE 档固定 stable（busy-poll，无 nightly feature）' : runtime === 'embassy' ? 'embassy 档需 nightly（impl_trait_in_assoc_type）' : '标准 rustup target') : (chip.nightly ? 'build-std=core（自定义 target）' : '稳定版 target') }}</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">HAL revision</div>
              <div class="ps-value">
                <a class="ps-link" :href="halRevUrl" target="_blank" rel="noopener"><code>{{ halRevShort }}</code></a>
                <span class="ps-note">{{ effectiveHalRev }}</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">HAL feature</div>
              <div class="ps-value"><code>{{ halFeatureLabel }}</code></div>
            </div>
          </div>
        </CollapsiblePanel>
      </div>

      <!-- Runtime（M6） -->
      <div id="ps-runtime" class="ps-section">
        <CollapsiblePanel v-model:open="open.runtime" title="Runtime">
          <div class="ps-rows">
            <!-- M17：仅当芯片声明 legacyHalBackend 时显示（CH582：ch5xx-hal 默认 / ch58x-hal legacy） -->
            <div v-if="chip.legacyHalBackend" class="ps-row">
              <div class="ps-label">HAL 后端</div>
              <div class="ps-value ps-runtime-value">
                <el-select
                  :model-value="backend"
                  size="small"
                  style="width: 220px"
                  @change="setHalBackend(String($event))"
                >
                  <el-option
                    v-for="opt in halBackendOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <span class="ps-note">
                  {{ isCh5xx
                    ? 'ch5xx-hal：上游重写版，nightly + build-std；BLE 走 ch5xx-ble shim'
                    : 'ch58x-hal：legacy 后端（stable），保留旧工程生成结果' }}
                </span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">运行时</div>
              <div class="ps-value ps-runtime-value">
                <el-radio-group
                  :model-value="runtime"
                  size="small"
                  :disabled="bleEnabled"
                  @change="setRuntime($event as RuntimeKind)"
                >
                  <el-radio-button value="blocking" :disabled="bleEnabled">blocking（阻塞）</el-radio-button>
                  <el-radio-button value="embassy" :disabled="bleEnabled || !embassySupported">embassy（async）</el-radio-button>
                  <el-radio-button value="rtic" disabled>rtic</el-radio-button>
                </el-radio-group>
                <span class="ps-note">
                  {{
                    bleEnabled
                      ? `BLE 档：busy-poll 运行时（${isCh5xx ? 'ch5xx-ble shim，nightly' : 'legacy，stable'}），不初始化 embassy 执行器/Timer`
                      : runtime === 'embassy'
                        ? isCh5xx
                          ? 'embassy 档：time-driver-tmr0；hal::init 内部初始化时间驱动（无 hal::embassy::init）'
                          : isCh58x
                            ? '生成 embassy 异步工程：GPIO 异步等待与 Timer；UART/SPI/I2C/ADC 按阻塞 API 初始化'
                            : '生成 embassy 异步工程：main.rs 使用 #[embassy_executor::main]，外设按 async API 初始化'
                        : isCh5xx
                          ? '生成阻塞式工程：nightly + build-std；main.rs 使用 #[qingke_rt::entry]，外设按 blocking API 初始化'
                          : isCh58x
                            ? '生成阻塞式工程：main.rs 使用 #[qingke_rt::entry]，外设按 blocking API 初始化'
                            : '生成阻塞式工程：main.rs 使用 #[entry]，外设按 blocking API 初始化'
                  }}
                </span>
              </div>
            </div>
            <div v-if="isCh58xFamily" class="ps-row">
              <div class="ps-label"></div>
              <div class="ps-value">
                <span class="ps-note">
                  {{ isCh5xx
                    ? 'ch5xx-hal 后端：embassy 档提供 GPIO 异步等待与 Timer（time-driver-tmr0）；SPI/I2C/UART 的 async 驱动上游已实现，本期生成器仍生成阻塞初始化。BLE 见下方 BLE 节（shim）。'
                    : 'ch58x-hal（legacy）后端：embassy 档提供 GPIO 异步等待与 Timer；UART/SPI/I2C/ADC 仍为阻塞驱动（HAL 无异步外设实现）。BLE 协议栈见下方 BLE 节。' }}
                </span>
              </div>
            </div>
            <div v-if="bleEnabled" class="ps-row">
              <div class="ps-label"></div>
              <div class="ps-value">
                <span class="ps-note ps-runtime-warn">
                  BLE 档使用 busy-poll 运行时：不初始化 embassy 执行器/Timer（ch5xx 档不启用 HAL 的 embassy/time-driver feature）；GPIO 异步等待本期 BLE 档不提供。
                </span>
              </div>
            </div>
            <div v-if="!embassySupported" class="ps-row">
              <div class="ps-label"></div>
              <div class="ps-value">
                <span class="ps-note ps-runtime-warn">该芯片（{{ chip.chip }}）暂不支持 embassy（chip.json unsupportedFeatures），已禁用。</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">rtic</div>
              <div class="ps-value">
                <span class="ps-note">{{ isCh5xx ? 'ch5xx-hal' : isCh58x ? 'ch58x-hal' : 'ch32-hal' }} 尚未提供 RTIC 支持，待 HAL 上游核实后再开放（不臆造生成路径）。</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">调试打印</div>
              <div class="ps-value">
                <el-switch :model-value="store.features.debugPrint" size="small" @change="setDebugPrint($event === true)" />
                <span class="ps-note">
                  {{
                    isCh5xx
                      ? 'ch5xx-hal 后端暂未提供调试打印：生成时按警告忽略，不阻塞生成'
                      : isCh58x
                        ? 'ch58x-hal 后端暂未提供调试打印：生成时按警告忽略，不阻塞生成'
                        : 'main.rs 内生成 println!（经 ch32-hal 的调试串口输出）'
                  }}
                </span>
              </div>
            </div>
          </div>
        </CollapsiblePanel>
      </div>

      <!-- BLE（M12/M17：CH58x 家族芯片；ch5xx → shim，legacy → 旧路径） -->
      <div v-if="supportsBle" id="ps-ble" class="ps-section">
        <CollapsiblePanel v-model:open="open.ble" title="BLE">
          <div class="ps-rows">
            <div class="ps-row">
              <div class="ps-label">启用 BLE</div>
              <div class="ps-value">
                <el-switch :model-value="bleEnabled" size="small" @change="setBleEnabled($event === true)" />
                <span class="ps-note">开启后使用 busy-poll 运行时；生成 src/generated/ble.rs 与启动代码（{{ isCh5xx ? 'ch5xx-ble shim' : 'legacy ch58x-hal' }}）</span>
              </div>
            </div>
          </div>
          <p class="ps-note ps-ble-note">
            BLE 档使用 busy-poll 运行时（连续轮询无 delay）：{{ isCh5xx
              ? 'ch5xx-hal 上游未实现 BLE，协议栈由自建 ch5xx-ble shim 包装（ble::init + ch5xx-metapac 平台胶水），不启用 HAL 的 embassy/time-driver feature。'
              : '绕开上游 ch58x-hal embassy 时间驱动（SysTick 空闲停计）与 qingke-rt 启动缺陷（mstatus.MIE=0）。' }}
            32K 低频域缺省 LSE（外部 32.768kHz 晶振，官方模组标配；M14 实机连接建立已验证）；无晶振板可选 LSI 回退（未移植 LSI 校准，连接稳定性未保证）。
            PA10/PA11（X32KI/X32KO）仍按 M12 契约保留不可分配。
            固定 ATT MTU 23、TX 6dBm、无绑定存储（SNV）；GPIO 异步等待本期 BLE 档不提供。详见 README 与契约文档。
          </p>
          <div class="ps-rows">
            <div class="ps-row">
              <div class="ps-label">GAP 角色</div>
              <div class="ps-value ps-ble-value">
                <el-radio-group :model-value="store.ble.role" size="small" @change="setBleRole($event as BleConfig['role'])">
                  <el-radio-button v-for="opt in bleRoleOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </el-radio-button>
                </el-radio-group>
                <span class="ps-note">{{ bleRoleDesc }}；central 上游无示例，本期不开放</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">设备名</div>
              <div class="ps-value ps-ble-value">
                <el-input
                  :model-value="store.ble.deviceName"
                  size="small"
                  style="width: 240px"
                  placeholder="CH582M"
                  @input="setBleName($event)"
                />
                <span class="ps-note" :class="{ 'ps-runtime-warn': bleNameTooLong }">
                  UTF-8 {{ bleNameBytes }} 字节（{{ store.ble.role }} 广播/扫描响应名称上限 {{ bleNameBudget }} 字节 · GAP 上限 {{ BLE_GAP_NAME_MAX }}；广播短名截断 8 字节）
                </span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">广播间隔</div>
              <div class="ps-value">
                <el-input-number
                  :model-value="store.ble.advIntervalMs"
                  size="small"
                  :min="20"
                  :max="10240"
                  :step="10"
                  @change="setAdvInterval($event)"
                />
                <span class="ps-note">ms；生成换算 0.625ms 单位（TGAP_DISC_ADV_INT_MIN/MAX，范围 20–10240）</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">32K 时钟源</div>
              <div class="ps-value ps-ble-value">
                <el-radio-group :model-value="store.ble.clock32k ?? 'lse'" size="small" @change="setBleClock32k($event as 'lse' | 'lsi')">
                  <el-radio-button value="lse">LSE 外部晶振</el-radio-button>
                  <el-radio-button value="lsi">LSI 内部</el-radio-button>
                </el-radio-group>
                <span class="ps-note" :class="{ 'ps-runtime-warn': (store.ble.clock32k ?? 'lse') === 'lsi' }">
                  {{ (store.ble.clock32k ?? 'lse') === 'lse'
                    ? `缺省：32.768kHz 晶振（官方模组标配），生成 ${isCh5xx ? 'ch5xx_ble::enable_lse()' : 'enable_lse()'} + SelRTCClock=0；连接建立实机已验证`
                    : `无晶振板回退：SelRTCClock=1${isCh5xx ? ' + ch5xx_ble::set_clock32k_lsi()' : ''}；LSI 校准未移植，连接稳定性未保证（广播可用）` }}
                </span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">MAC 来源</div>
              <div class="ps-value ps-ble-value">
                <el-select
                  :model-value="store.ble.macSource"
                  size="small"
                  style="width: 190px"
                  @change="setMacSource($event as BleConfig['macSource'])"
                >
                  <el-option v-for="opt in bleMacSourceOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
                <span class="ps-note">{{ bleMacSourceDesc }}</span>
                <template v-if="store.ble.macSource === 'custom'">
                  <el-input
                    :model-value="store.ble.mac ?? ''"
                    size="small"
                    style="width: 200px"
                    placeholder="AA:BB:CC:DD:EE:FF"
                    @change="setCustomMac($event)"
                  />
                  <span class="ps-note">6 段十六进制（人读序，生成 MacAddress::from_msb / ble::Config.mac_lsb）</span>
                </template>
              </div>
            </div>
            <div v-if="store.ble.role === 'peripheral'" class="ps-row">
              <div class="ps-label">GATT UUID16</div>
              <div class="ps-value ps-ble-value">
                <span class="ps-note">服务</span>
                <el-input
                  :model-value="fmtUuid(store.ble.serviceUuid16)"
                  size="small"
                  style="width: 96px"
                  @change="setUuid('serviceUuid16', $event)"
                />
                <span class="ps-note">notify</span>
                <el-input
                  :model-value="fmtUuid(store.ble.notifyUuid16)"
                  size="small"
                  style="width: 96px"
                  @change="setUuid('notifyUuid16', $event)"
                />
                <span class="ps-note">write</span>
                <el-input
                  :model-value="fmtUuid(store.ble.writeUuid16)"
                  size="small"
                  style="width: 96px"
                  @change="setUuid('writeUuid16', $event)"
                />
              </div>
            </div>
            <div v-if="store.ble.role === 'observer'" class="ps-row">
              <div class="ps-label">扫描</div>
              <div class="ps-value ps-ble-value">
                <el-input-number
                  :model-value="store.ble.scanMs"
                  size="small"
                  :min="1"
                  :max="10240"
                  :step="100"
                  @change="setScanMs($event)"
                />
                <span class="ps-note">ms 扫描窗口（生成换算 0.625ms 单位，TGAP_DISC_SCAN）</span>
                <el-checkbox :model-value="store.ble.activeScan" size="small" @change="setActiveScan($event === true)">
                  主动扫描（activeScan）
                </el-checkbox>
              </div>
            </div>
          </div>
        </CollapsiblePanel>
      </div>

      <!-- Generation（M7：页内决议中心，对齐 CubeMX2 IDE Project Generation） -->
      <div id="ps-generation" class="ps-section">
        <CollapsiblePanel v-model:open="open.generation" title="Code Generation">
          <div class="ps-gen-checks">
            <el-checkbox v-for="it in generationItems" :key="it.key" v-model="selection[it.key]">
              <span class="ps-check-label">{{ it.label }}</span>
              <span class="ps-check-desc">{{ it.desc }}</span>
            </el-checkbox>
          </div>
          <el-checkbox v-model="includeMain" class="ps-main-check">
            包含 src/main.rs 骨架（双核为各核 src/main.rs；已有自己的 main.rs 时取消勾选，生成器永不覆盖用户文件）
          </el-checkbox>
          <div class="ps-rows">
            <div class="ps-row">
              <div class="ps-label">构建档位</div>
              <div class="ps-value">
                <el-select v-model="selection.profile" size="small" style="width: 200px">
                  <el-option label="体积优先 (release-size)" value="release-size" />
                  <el-option label="速度优先 (release-speed)" value="release-speed" />
                  <el-option label="可调试 (release-debug)" value="release-debug" />
                </el-select>
                <span class="ps-note">写入 Cargo.toml 标记区 profile</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">IDE 配置</div>
              <div class="ps-value">
                <el-select v-model="selection.ideConfig" size="small" style="width: 140px">
                  <el-option label="不生成" value="none" />
                  <el-option label="VS Code" value="vscode" />
                </el-select>
                <span class="ps-note">.vscode/settings.json + tasks.json</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">导出方式</div>
              <div class="ps-value ps-dest-value">
                <el-radio-group v-model="exportMode" size="small">
                  <el-radio-button value="zip">ZIP 归档</el-radio-button>
                  <el-radio-button value="folder" :disabled="!canWriteFolder">本地目录</el-radio-button>
                </el-radio-group>
                <template v-if="exportMode === 'folder'">
                  <el-button size="small" :icon="FolderOpened" @click="pickFolder">选择目录…</el-button>
                  <code v-if="folderTarget" class="ps-dest-path">{{ folderTarget.root }}</code>
                  <span v-else class="ps-note">未选择（生成时会再次询问）</span>
                </template>
                <span v-else class="ps-note">浏览器下载 / 桌面端原生保存对话框</span>
                <span v-if="!canWriteFolder && folderHint" class="ps-note ps-runtime-warn">{{ folderHint }}</span>
              </div>
            </div>
          </div>
          <div class="ps-sub-title">生成前检查</div>
          <PreflightPanel :report="checkReport" />
          <el-checkbox v-if="checkReport.warnings.length > 0" v-model="warnAcknowledged" class="ps-main-check">
            我已知晓上述 {{ checkReport.warnings.length }} 个警告，继续生成
          </el-checkbox>
          <p class="ps-note ps-gen-note">
            cube.json（配置回读）与 generated/mod.rs 始终生成。已存在的文件按 Advanced 的 fileGroup 策略处理；
            目录导出的逐文件冲突决议在下方「导出预览」段页内完成。
          </p>
          <div class="ps-gen-actions">
            <el-button type="primary" :icon="Promotion" :loading="generating || writingFolder" @click="onGenerate">
              {{ writingFolder ? '正在写入…' : generating ? '正在生成…' : '生成工程' }}
            </el-button>
            <el-button plain :disabled="generating || writingFolder" @click="exportConfigOnly">仅导出配置 (cube.json)</el-button>
            <span class="ps-note">一切决议在本页完成，无弹窗（对齐 CubeMX2）</span>
          </div>
        </CollapsiblePanel>
      </div>

      <!-- 导出预览 / 冲突决议（M7：页内两段式，仅有冲突或删除时出现） -->
      <div v-if="pendingFolder" id="ps-preview" class="ps-section">
        <CollapsiblePanel v-model:open="open.preview" title="导出预览 · 冲突决议">
          <ExportPlanPreview
            :plan="pendingFolder.inspection.plan"
            :summary="pendingFolder.inspection.summary"
            :readable="pendingFolder.inspection.readable"
            :manifest-found="pendingFolder.inspection.manifestFound"
          />
          <ConflictRules v-if="conflictEntries.length > 0" :conflicts="conflictEntries" v-model="resolutions" />
          <div class="ps-gen-actions">
            <el-button :disabled="writingFolder" @click="cancelFolderPreview">返回</el-button>
            <el-button type="primary" :icon="FolderOpened" :loading="writingFolder" @click="confirmFolderWrite">
              {{ writingFolder ? '正在写入…' : '确认写入' }}
            </el-button>
          </div>
        </CollapsiblePanel>
      </div>

      <!-- 生成结果（M7：页内报告，替代原对话框结果页） -->
      <div v-if="report" id="ps-result" class="ps-section">
        <CollapsiblePanel v-model:open="open.result" title="生成结果">
          <GenerationReport :report="report" />
          <div class="ps-gen-actions">
            <el-button type="primary" @click="finishReport">完成</el-button>
          </div>
        </CollapsiblePanel>
      </div>

      <!-- Advanced -->
      <div id="ps-advanced" class="ps-section">
        <CollapsiblePanel v-model:open="open.advanced" title="Advanced">
          <p class="ps-adv-hint">
            再生成安全网（M1）：生成器通过 <code>.ch32cube/export-manifest.json</code> 记录上次导出的文件哈希；
            用户手改过的文件不会被静默覆盖，而是进入冲突决议（M7：决议在「导出预览」段页内逐项完成，无弹窗）。
          </p>
          <table class="ps-table">
            <thead>
              <tr>
                <th style="width: 130px">fileGroup</th>
                <th style="width: 300px">路径示例</th>
                <th>再生成策略</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in groupPolicies" :key="row.group">
                <td><code>{{ row.group }}</code></td>
                <td class="ps-paths">{{ row.paths }}</td>
                <td>{{ row.policy }}</td>
              </tr>
            </tbody>
          </table>

          <div class="ps-sub-title">Automatic Conflict Handling Rules</div>
          <p class="ps-note ps-policy-hint">
            类别级默认决议（对齐 CubeMX2）：仅决定冲突（conflict）条目的默认处理方式，导出预览里的逐文件选择优先；
            user_code 永不覆盖，不受策略影响；「标记区合并」仅对 project_file 有意义（Cargo.toml 标记区），
            其它组选它时按覆盖处理。策略随 cube.json 保存。
          </p>
          <table class="ps-table ps-policy-table">
            <thead>
              <tr>
                <th style="width: 130px">Category</th>
                <th>Rule</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>All</code></td>
                <td>
                  <el-select
                    :model-value="store.conflictPolicy.mode"
                    size="small"
                    style="width: 300px"
                    @change="setPolicyMode($event as ConflictPolicyMode)"
                  >
                    <el-option
                      v-for="opt in policyModeOptions"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                  </el-select>
                </td>
              </tr>
              <template v-if="store.conflictPolicy.mode === 'custom'">
                <tr v-for="row in policyGroupRows" :key="row.group">
                  <td><code>{{ row.group }}</code></td>
                  <td>
                    <el-select
                      :model-value="policyGroupRule(row.group)"
                      size="small"
                      style="width: 300px"
                      @change="setPolicyGroupRule(row.group, $event as ConflictResolution)"
                    >
                      <el-option
                        v-for="value in row.options"
                        :key="value"
                        :label="policyRuleLabels[value]"
                        :value="value"
                      />
                    </el-select>
                  </td>
                </tr>
                <tr>
                  <td><code>user_code</code></td>
                  <td><el-tag type="info" size="small">永不覆盖（硬保护，不受策略影响）</el-tag></td>
                </tr>
              </template>
            </tbody>
          </table>

          <div class="ps-sub-title">冲突决议选项</div>
          <div class="ps-resolution-grid">
            <div v-for="opt in resolutionOptions" :key="opt.label" class="ps-resolution-item">
              <strong>{{ opt.label }}</strong>
              <span class="ps-note">{{ opt.desc }}</span>
            </div>
          </div>

          <div class="ps-conflict-status" :class="{ 'has-error': store.errorCount > 0, 'has-warning': store.warningCount > 0 }">
            当前冲突检查：<strong>{{ store.errorCount }}</strong> 个错误 ·
            <strong>{{ store.warningCount }}</strong> 个警告
            <el-button link type="primary" size="small" @click="store.setView('pinout')">前往 Pinout 查看</el-button>
          </div>
        </CollapsiblePanel>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-settings {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 14px 20px 24px;
}
.ps-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}
.page-title {
  font-size: var(--mx-fz-page-title);
  font-weight: 600;
  margin: 0;
}
.page-sub {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  margin-top: 2px;
}
.ps-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.ps-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1080px;
}
.ps-section {
  scroll-margin-top: 8px;
}
.ps-rows {
  display: flex;
  flex-direction: column;
}
.ps-row {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid var(--mx-border);
}
.ps-row:last-child {
  border-bottom: none;
}
.ps-label {
  width: 120px;
  flex-shrink: 0;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
}
.ps-value {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: var(--mx-fz-body);
  color: var(--mx-text);
  overflow-wrap: anywhere;
}
.ps-value code,
.ps-adv-hint code,
.ps-table code {
  font-family: var(--mx-font-mono);
  font-size: 12px;
  color: var(--mx-text-secondary);
  background: #f2f5fa;
  border-radius: 4px;
  padding: 1px 5px;
}
.ps-storage-value {
  flex-wrap: wrap;
}
.ps-runtime-value {
  flex-wrap: wrap;
}
.ps-ble-value {
  flex-wrap: wrap;
}
.ps-ble-note {
  margin: 8px 0 10px;
  line-height: 1.6;
}
.ps-runtime-warn {
  color: var(--mx-warning);
}
.ps-note {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
}
.ps-link {
  color: var(--mx-accent);
  text-decoration: none;
}
.ps-link:hover {
  text-decoration: underline;
}
.ps-gen-checks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 20px;
  margin-bottom: 10px;
}
/* Element Plus 默认 nowrap + 固定高度会裁掉右列描述，这里允许换行 */
.ps-gen-checks :deep(.el-checkbox) {
  display: flex;
  align-items: flex-start;
  min-width: 0;
  width: 100%;
  height: auto;
  margin-right: 0;
  white-space: normal;
}
.ps-gen-checks :deep(.el-checkbox__input) {
  flex-shrink: 0;
  margin-top: 1px;
}
.ps-gen-checks :deep(.el-checkbox__label) {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.ps-check-label {
  font-weight: 600;
  margin-right: 4px;
}
.ps-check-desc {
  font-size: 11px;
  color: var(--mx-text-muted);
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.ps-main-check {
  display: flex;
  align-items: flex-start;
  height: auto;
  margin: 4px 0 8px;
  white-space: normal;
}
.ps-main-check :deep(.el-checkbox__input) {
  flex-shrink: 0;
  margin-top: 1px;
}
.ps-main-check :deep(.el-checkbox__label) {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.ps-dest-value {
  flex-wrap: wrap;
}
.ps-dest-path {
  font-family: var(--mx-font-mono);
  font-size: 12px;
  color: var(--mx-text-secondary);
  background: #f2f5fa;
  border-radius: 4px;
  padding: 1px 5px;
  overflow-wrap: anywhere;
}
.ps-gen-note {
  margin: 10px 0 0;
  line-height: 1.5;
}
.ps-gen-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.ps-adv-hint {
  margin: 0 0 10px;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-secondary);
  line-height: 1.6;
}
.ps-policy-hint {
  margin: 0 0 8px;
  line-height: 1.5;
}
.ps-policy-table {
  max-width: 640px;
}
.ps-policy-table td {
  vertical-align: middle;
}
.ps-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--mx-fz-label);
}
.ps-table th {
  text-align: left;
  font-weight: 600;
  color: var(--mx-text-muted);
  padding: 6px 8px;
  border-bottom: 1px solid var(--mx-border);
  background: #f7f9fc;
}
.ps-table td {
  padding: 8px;
  border-bottom: 1px solid var(--mx-border);
  vertical-align: top;
  color: var(--mx-text-secondary);
  line-height: 1.5;
}
.ps-paths {
  font-family: var(--mx-font-mono);
  font-size: 11px;
  color: var(--mx-text-secondary);
  overflow-wrap: anywhere;
}
.ps-sub-title {
  margin: 16px 0 8px;
  font-size: var(--mx-fz-body);
  font-weight: 600;
  color: var(--mx-text);
}
.ps-resolution-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}
.ps-resolution-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--mx-border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: var(--mx-fz-label);
}
.ps-conflict-status {
  margin-top: 14px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #f2f5fa;
  color: var(--mx-text-secondary);
  font-size: var(--mx-fz-label);
}
.ps-conflict-status.has-warning {
  background: #fff4e0;
  color: var(--mx-warning);
}
.ps-conflict-status.has-error {
  background: #fde7e7;
  color: var(--mx-error);
}
</style>