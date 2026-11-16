<script setup lang="ts">
// Project settings 主视图（M2.4）：General / Generation / Advanced 三段可折叠面板。
// General 编辑工程名并只读展示芯片、target、toolchain、HAL rev；
// Generation 说明导出选项并打开 CodegenDialog（与 Pinout 共用同一生成服务）；
// Advanced 展示 M1 再生成安全网的 fileGroup 策略与冲突决议选项。
import { computed, reactive, ref, watch } from 'vue'
import { Expand, Fold, Menu, Promotion } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { HAL_GIT } from '@/model/codegen/halRev'
import CollapsiblePanel from '@/components/common/CollapsiblePanel.vue'
import CodegenDialog from '@/components/CodegenDialog.vue'

const store = useProjectStore()

// ---- General ----
const projectName = ref(store.projectName)
watch(
  () => store.projectName,
  (name) => {
    projectName.value = name
  },
)

const chip = computed(() => store.deviceData.chip)
const toolchain = computed(() => (chip.value.nightly ? 'nightly + rust-src' : 'stable'))
const halRevShort = computed(() => store.halRev.slice(0, 12))
const halRevUrl = computed(() => `${HAL_GIT.replace(/\.git$/, '')}/commit/${store.halRev}`)

function commitProjectName() {
  const name = projectName.value.trim() || 'ch32-project'
  projectName.value = name
  if (name !== store.projectName) store.setProjectName(name)
}

// ---- Generation ----
const showGenerate = ref(false)

const generationItems: { label: string; desc: string }[] = [
  { label: '工程骨架', desc: 'Cargo.toml / rust-toolchain / .cargo / build.rs / target json' },
  { label: '内嵌 HAL 源码', desc: 'vendor/ch32-hal（path 依赖，便于查阅 HAL 代码）' },
  { label: '时钟配置', desc: 'src/generated/clock.rs' },
  { label: 'GPIO 引脚', desc: 'src/generated/pins.rs' },
  { label: 'EXTI', desc: 'src/generated/exti.rs（存在外部中断配置时）' },
  { label: 'USART / SPI / I2C / ADC', desc: 'src/generated/{usart,spi,i2c,adc}.rs' },
  { label: 'README', desc: '工程说明与引脚/外设摘要' },
]

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

// ---- 章节展开 / 导航 ----
const open = reactive({ general: true, generation: true, advanced: true })

function expandAll() {
  open.general = true
  open.generation = true
  open.advanced = true
}

function collapseAll() {
  open.general = false
  open.generation = false
  open.advanced = false
}

function scrollTo(command: string | number | object) {
  const section = String(command)
  document.getElementById(`ps-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openGenerate() {
  commitProjectName()
  showGenerate.value = true
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
              <el-dropdown-item command="generation">Generation</el-dropdown-item>
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
                <el-input
                  v-model="projectName"
                  size="small"
                  class="ps-name-input"
                  placeholder="ch32-project"
                  @change="commitProjectName"
                  @keyup.enter="commitProjectName"
                />
                <span class="ps-note">写入 cube.json 与生成的 Cargo package 名（Ctrl+S 保存工程）</span>
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

      <!-- Generation -->
      <div id="ps-generation" class="ps-section">
        <CollapsiblePanel v-model:open="open.generation" title="Generation">
          <el-alert
            v-if="store.errorCount > 0"
            type="error"
            :closable="false"
            class="ps-alert"
            :title="`存在 ${store.errorCount} 个错误级冲突，生成将被阻止。请先在 Pinout 冲突面板修复。`"
          />
          <div class="ps-gen-grid">
            <div v-for="item in generationItems" :key="item.label" class="ps-gen-item">
              <div class="ps-gen-label">{{ item.label }}</div>
              <div class="ps-gen-desc">{{ item.desc }}</div>
            </div>
          </div>
          <p class="ps-note ps-gen-note">
            cube.json（配置回读）与 generated/mod.rs 始终生成。生成对话框支持导出 ZIP 或写入本地目录；
            已存在的文件按 Advanced 的 fileGroup 策略处理。
          </p>
          <div class="ps-gen-actions">
            <el-button type="primary" :icon="Promotion" @click="openGenerate">生成工程</el-button>
            <span class="ps-note">打开代码生成对话框（选项确认 / ZIP / 目录导出）</span>
          </div>
        </CollapsiblePanel>
      </div>

      <!-- Advanced -->
      <div id="ps-advanced" class="ps-section">
        <CollapsiblePanel v-model:open="open.advanced" title="Advanced">
          <p class="ps-adv-hint">
            再生成安全网（M1）：生成器通过 <code>.ch32cube/export-manifest.json</code> 记录上次导出的文件哈希；
            用户手改过的文件不会被静默覆盖，而是进入冲突决议。
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

    <!-- 页面内直接挂载生成对话框：与 Pinout 的导出共用 services/projectExport -->
    <CodegenDialog v-if="showGenerate" v-model="showGenerate" />
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
.ps-name-input {
  width: 280px;
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
.ps-alert {
  margin-bottom: 12px;
}
.ps-gen-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px 16px;
}
.ps-gen-item {
  padding: 6px 0;
  border-bottom: 1px dashed var(--mx-border);
}
.ps-gen-label {
  font-size: var(--mx-fz-body);
  font-weight: 600;
  color: var(--mx-text);
}
.ps-gen-desc {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  margin-top: 1px;
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