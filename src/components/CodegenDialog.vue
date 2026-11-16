<script setup lang="ts">
// 代码生成导出对话框（视图层）：子项选择 + 触发导出。
// 生成/打包/落盘编排全部在 services/projectExport.ts；本组件只管理选项与提示。
import { computed, reactive, ref } from 'vue'
import { Download, FolderOpened } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { downloadProjectFile } from '@/services/projectFile'
import {
  ExportBlockedError,
  exportAsZip,
  folderExportHint,
  isAbortError,
  pickExportFolder,
  prepareExport,
  supportsFolderExport,
} from '@/services/projectExport'
import { DEFAULT_SELECTION, type CodegenSelection } from '@/model/types'

const store = useProjectStore()
const visible = defineModel<boolean>({ default: false })

const selection = reactive<CodegenSelection>({ ...DEFAULT_SELECTION })
const includeMain = ref(true)
const projectName = ref(store.projectName)
const generating = ref(false)
const writingFolder = ref(false)

const canWriteFolder = supportsFolderExport()
const folderHint = folderExportHint()

const items: { key: keyof CodegenSelection; label: string; desc: string }[] = [
  { key: 'projectSkeleton', label: '工程骨架', desc: 'Cargo.toml / rust-toolchain / .cargo / build.rs / target json' },
  { key: 'vendorHal', label: '内嵌 HAL 源码', desc: 'vendor/ch32-hal 完整库（path 依赖，便于查阅代码）' },
  { key: 'clock', label: '时钟配置', desc: 'generated/clock.rs' },
  { key: 'pins', label: 'GPIO 引脚', desc: 'generated/pins.rs' },
  { key: 'exti', label: 'EXTI', desc: 'generated/exti.rs（有配置时）' },
  { key: 'usart', label: 'USART', desc: 'generated/usart.rs' },
  { key: 'spi', label: 'SPI', desc: 'generated/spi.rs' },
  { key: 'i2c', label: 'I2C', desc: 'generated/i2c.rs' },
  { key: 'adc', label: 'ADC', desc: 'generated/adc.rs' },
  { key: 'readme', label: 'README', desc: '说明文档' },
]

const errorCount = computed(() => store.errorCount)

async function exportConfigOnly() {
  store.setProjectName(projectName.value || 'ch32-project')
  try {
    const saved = await downloadProjectFile(store.config)
    if (saved) store.notify(`已导出 ${store.config.projectName}.cube.json`, 'info')
  } catch (e) {
    store.notify(`保存配置失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

/** 生成并导出 ZIP。 */
async function doExportZip() {
  if (generating.value || writingFolder.value) return
  generating.value = true
  try {
    store.setProjectName(projectName.value || 'ch32-project')
    const prepared = await prepareExport(store.config, store.deviceData, { ...selection }, includeMain.value)
    const count = await exportAsZip(prepared, store.config.projectName)
    if (count === null) return // 用户在保存对话框中取消
    store.setExportSnapshot(prepared.snapshot)
    store.notify(`已导出 ${count} 个文件${selection.vendorHal ? '（含完整 HAL 源码）' : ''}（${store.config.projectName}.zip）`, 'info')
    visible.value = false
  } catch (e) {
    if (e instanceof ExportBlockedError) {
      store.notify(`导出被阻止：${e.message}`, 'error')
      return
    }
    store.notify(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    generating.value = false
  }
}

/** 生成并写入目录（桌面端原生对话框 / 浏览器 File System Access API）。 */
async function doExportFolder() {
  if (writingFolder.value || generating.value || !canWriteFolder) return
  writingFolder.value = true
  try {
    // 目录选择必须在用户点击手势内直接调用：先选目录，再生成内容
    const target = await pickExportFolder()
    if (!target) return // 用户取消
    const prepared = await prepareExport(store.config, store.deviceData, { ...selection }, includeMain.value)
    const result = await target.write(prepared)
    store.setExportSnapshot(prepared.snapshot)
    store.notify(`已写入 ${result.written} 个文件到 ${result.root}`, 'info')
    visible.value = false
  } catch (e) {
    if (e instanceof ExportBlockedError) {
      store.notify(`导出被阻止：${e.message}`, 'error')
      return
    }
    // 用户取消目录选择：静默返回
    if (isAbortError(e)) return
    store.notify(`写入目录失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    writingFolder.value = false
  }
}
</script>


<template>
  <el-dialog v-model="visible" title="生成 Rust 工程" width="640px">
    <el-alert v-if="errorCount > 0" type="error" :closable="false" class="export-alert"
      :title="`存在 ${errorCount} 个错误级冲突，导出将被阻止。请先在冲突面板修复。`" />
    <div class="form-row">
      <label>工程名</label>
      <el-input v-model="projectName" size="small" style="width: 240px" placeholder="ch32-project" />
    </div>
    <div class="selection-grid">
      <el-checkbox v-for="it in items" :key="it.key" v-model="selection[it.key]">
        <span class="sel-label">{{ it.label }}</span>
        <span class="sel-desc">{{ it.desc }}</span>
      </el-checkbox>
    </div>
    <el-checkbox v-model="includeMain" class="main-check">
      包含 src/main.rs 骨架（双核为各核 src/main.rs；已有自己的 main.rs 时取消勾选，生成器永不覆盖用户文件）
    </el-checkbox>
    <p class="hint">cube.json（配置回读）与 generated/mod.rs 始终生成。导出后可直接 <code>cargo build --release</code>。</p>
    <template #footer>
      <div class="dialog-footer">
        <el-button plain @click="exportConfigOnly">仅导出配置 (cube.json)</el-button>
        <el-button @click="visible = false">取消</el-button>
        <el-button plain :icon="Download" :loading="generating" :disabled="errorCount > 0 || writingFolder" @click="doExportZip">
          导出 ZIP
        </el-button>
        <el-tooltip :content="folderHint" :disabled="!folderHint" placement="top">
          <span class="folder-btn-wrap">
            <el-button
              type="primary"
              :icon="FolderOpened"
              :loading="writingFolder"
              :disabled="errorCount > 0 || generating || !canWriteFolder"
              @click="doExportFolder"
            >
              {{ writingFolder ? '正在写入…' : '导出到文件夹' }}
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.export-alert {
  margin-bottom: 12px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.form-row label {
  font-size: 13px;
  color: var(--mx-text-secondary);
}
.selection-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 20px;
  margin-bottom: 12px;
}
/* Element Plus 默认 white-space:nowrap + 固定高度会把右列文字裁掉，这里允许换行 */
.selection-grid :deep(.el-checkbox) {
  display: flex;
  align-items: flex-start;
  min-width: 0;
  width: 100%;
  height: auto;
  margin-right: 0;
  white-space: normal;
}
.selection-grid :deep(.el-checkbox__input) {
  flex-shrink: 0;
  margin-top: 1px;
}
.selection-grid :deep(.el-checkbox__label) {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.sel-label {
  font-weight: 600;
  margin-right: 4px;
}
.sel-desc {
  font-size: 11px;
  color: var(--mx-text-muted);
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.main-check {
  display: flex;
  align-items: flex-start;
  height: auto;
  margin-bottom: 8px;
  white-space: normal;
}
.main-check :deep(.el-checkbox__input) {
  flex-shrink: 0;
  margin-top: 1px;
}
.main-check :deep(.el-checkbox__label) {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.dialog-footer {
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.dialog-footer :deep(.el-button) {
  flex-shrink: 0;
  margin-left: 0;
}
.folder-btn-wrap {
  display: inline-block;
  flex-shrink: 0;
}
.hint {
  font-size: 12px;
  color: var(--mx-text-muted);
  margin: 0;
}
</style>