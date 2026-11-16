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
import type { ConflictPolicyMode, ConflictResolution, FileGroup } from '@/model/types'
import { useProjectStore } from '@/controllers/project'
import { HAL_GIT } from '@/model/codegen/halRev'
import { storagePreview, wizardIsDesktop } from '@/components/home/CreateProjectWizard.vue'
import CollapsiblePanel from '@/components/common/CollapsiblePanel.vue'
import PreflightPanel from '@/components/codegen/PreflightPanel.vue'
import ExportPlanPreview from '@/components/codegen/ExportPlanPreview.vue'
import ConflictRules from '@/components/codegen/ConflictRules.vue'
import GenerationReport from '@/components/codegen/GenerationReport.vue'
import { useGenerationFlow, GENERATION_ITEMS } from '@/components/codegen/useGenerationFlow'

const store = useProjectStore()

// ---- General（M9：名称与存储位置创建时设定，此处只读） ----
const chip = computed(() => store.deviceData.chip)
const toolchain = computed(() => (chip.value.nightly ? 'nightly + rust-src' : 'stable'))
const halRevShort = computed(() => store.halRev.slice(0, 12))
const halRevUrl = computed(() => `${HAL_GIT.replace(/\.git$/, '')}/commit/${store.halRev}`)
const storage = computed(() => storagePreview(wizardIsDesktop(), store.projectName))

// ---- Runtime（M6：运行时一等公民） ----
// features.embassy 驱动生成器（main.rs / 外设 async API / DMA 冲突规则），此前无 UI 开关。
// rtic 在 ch32-hal 尚未支持：选项禁激活并诚实标注，不臆造生成路径。
type RuntimeKind = 'blocking' | 'embassy' | 'rtic'
const runtime = computed<RuntimeKind>(() => (store.features.embassy ? 'embassy' : 'blocking'))
const embassySupported = computed(() => !(chip.value.unsupportedFeatures ?? []).includes('embassy'))

function setRuntime(kind: RuntimeKind) {
  if (kind === 'rtic') return
  if (kind === 'embassy' && !embassySupported.value) return
  store.setFeatures({ embassy: kind === 'embassy' })
  store.notify(kind === 'embassy' ? '运行时已切换为 embassy（async）' : '运行时已切换为 blocking（阻塞）', 'info')
}

function setDebugPrint(v: boolean) {
  store.setFeatures({ debugPrint: v })
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

const generationItems = GENERATION_ITEMS

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
const open = reactive({ general: true, runtime: true, generation: true, preview: true, result: true, advanced: true })

function expandAll() {
  open.general = true
  open.runtime = true
  open.generation = true
  open.preview = true
  open.result = true
  open.advanced = true
}

function collapseAll() {
  open.general = false
  open.runtime = false
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
                <span class="ps-note">{{ chip.nightly ? 'build-std=core（自定义 target）' : '稳定版 target' }}</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">HAL revision</div>
              <div class="ps-value">
                <a class="ps-link" :href="halRevUrl" target="_blank" rel="noopener"><code>{{ halRevShort }}</code></a>
                <span class="ps-note">{{ store.halRev }}</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">HAL feature</div>
              <div class="ps-value"><code>{{ chip.halFeature }}</code></div>
            </div>
          </div>
        </CollapsiblePanel>
      </div>

      <!-- Runtime（M6） -->
      <div id="ps-runtime" class="ps-section">
        <CollapsiblePanel v-model:open="open.runtime" title="Runtime">
          <div class="ps-rows">
            <div class="ps-row">
              <div class="ps-label">运行时</div>
              <div class="ps-value ps-runtime-value">
                <el-radio-group :model-value="runtime" size="small" @change="setRuntime($event as RuntimeKind)">
                  <el-radio-button value="blocking">blocking（阻塞）</el-radio-button>
                  <el-radio-button value="embassy" :disabled="!embassySupported">embassy（async）</el-radio-button>
                  <el-radio-button value="rtic" disabled>rtic</el-radio-button>
                </el-radio-group>
                <span class="ps-note">
                  {{
                    runtime === 'embassy'
                      ? '生成 embassy 异步工程：main.rs 使用 #[embassy_executor::main]，外设按 async API 初始化'
                      : '生成阻塞式工程：main.rs 使用 #[entry]，外设按 blocking API 初始化'
                  }}
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
                <span class="ps-note">ch32-hal 尚未提供 RTIC 支持，待 HAL 上游核实后再开放（不臆造生成路径）。</span>
              </div>
            </div>
            <div class="ps-row">
              <div class="ps-label">调试打印</div>
              <div class="ps-value">
                <el-switch :model-value="store.features.debugPrint" size="small" @change="setDebugPrint($event === true)" />
                <span class="ps-note">main.rs 内生成 println!（经 ch32-hal 的调试串口输出）</span>
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