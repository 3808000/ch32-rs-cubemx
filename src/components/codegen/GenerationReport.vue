<script lang="ts">
// 生成结果报告数据（M4.2）：由 CodegenDialog 在 ZIP/目录导出成功后组装，本面板只做展示。
import type { ExportAction } from '@/model/types'
import type { ExportPlanSummary } from '@/services/exportPlan'

export interface GenerationReportFile {
  path: string
  action: ExportAction
}

export interface GenerationReportData {
  /** zip：浏览器下载/桌面另存；folder：目录写入 */
  mode: 'zip' | 'folder'
  projectName: string
  /** ZIP 文件名或目标目录 */
  target: string
  /** 桌面端可定位的完整目录（浏览器目录句柄只有 name，不提供打开） */
  targetPath?: string
  /** 生成 + 打包/写盘耗时（毫秒） */
  elapsedMs: number
  written: number
  deleted: number
  skipped: number
  backedUp: number
  manifestWritten: boolean
  /** 逐文件动作（目录导出来自 inspect plan；ZIP 全部为 create） */
  files: GenerationReportFile[]
  /** 目录导出的 plan 摘要；ZIP 按写入文件数填充 */
  summary?: ExportPlanSummary
  /** 导出前检查中用户已确认的警告 */
  warnings?: string[]
  /** 附加提示（如目标目录不可读） */
  notes?: string[]
}
</script>

<script setup lang="ts">
// 生成结果报告面板（M4.2）：文件计数、manifest、耗时、目标与按 action 分组的可折叠清单。
// 纯展示：不做 IO/决策；「完成」由父级 CodegenDialog 页脚处理。
import { computed, ref } from 'vue'
import { CircleCheckFilled, FolderOpened } from '@element-plus/icons-vue'
import { isDesktopApp } from '@/services/desktop'

const props = defineProps<{ report: GenerationReportData }>()

/** 每个 action 的展示名与标签色。 */
const ACTION_META: Record<
  ExportAction,
  { label: string; type: 'success' | 'primary' | 'danger' | 'warning' | 'info' }
> = {
  create: { label: '新建', type: 'success' },
  update: { label: '更新', type: 'primary' },
  delete: { label: '删除', type: 'danger' },
  conflict: { label: '冲突', type: 'warning' },
  unchanged: { label: '保留', type: 'info' },
}

const ACTION_ORDER: ExportAction[] = ['create', 'update', 'delete', 'conflict', 'unchanged']
/** 单个 action 组最多渲染的条目数：vendor HAL 有 500+ 文件，避免一次插入过多 DOM。 */
const MAX_FILES_PER_ACTION = 200

const groups = computed(() =>
  ACTION_ORDER.map((action) => ({
    action,
    ...ACTION_META[action],
    files: props.report.files.filter((f) => f.action === action),
  })).filter((g) => g.files.length > 0),
)

// 默认展开小分组与删除/冲突；大分组（如 ZIP 内 vendor 源码）默认折叠
const openGroups = ref<string[]>(
  groups.value
    .filter((g) => g.action === 'delete' || g.action === 'conflict' || g.files.length <= 100)
    .map((g) => g.action),
)

const warnings = computed(() => props.report.warnings ?? [])
const notes = computed(() => props.report.notes ?? [])
/** 桌面端目录导出才可能「打开所在目录」；desktop.ts 当前尚无该能力（标注待核实）。 */
const canRevealTarget = computed(() => props.report.mode === 'folder' && isDesktopApp())

/** 耗时展示：<1s 用毫秒，<10s 保留一位小数，更长取整。 */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.round(ms / 1000)} s`
}
</script>

<template>
  <div class="generation-report">
    <div class="gr-head">
      <el-icon :size="34" class="gr-icon"><CircleCheckFilled /></el-icon>
      <div class="gr-head-text">
        <div class="gr-title">导出完成</div>
        <div class="gr-sub">
          <el-tag size="small" effect="plain" type="success">
            {{ report.mode === 'zip' ? 'ZIP 压缩包' : '目标目录' }}
          </el-tag>
          <code class="gr-target" :title="report.targetPath ?? report.target">{{ report.target }}</code>
        </div>
      </div>
    </div>

    <div class="gr-stats">
      <div class="gr-stat">
        <span class="gr-num success">{{ report.written }}</span>
        <span class="gr-label">写入</span>
      </div>
      <div class="gr-stat">
        <span class="gr-num" :class="{ danger: report.deleted > 0 }">{{ report.deleted }}</span>
        <span class="gr-label">删除</span>
      </div>
      <div class="gr-stat">
        <span class="gr-num">{{ report.skipped }}</span>
        <span class="gr-label">跳过/保留</span>
      </div>
      <div class="gr-stat">
        <span class="gr-num" :class="{ warning: report.backedUp > 0 }">{{ report.backedUp }}</span>
        <span class="gr-label">备份</span>
      </div>
    </div>

    <div v-if="report.summary" class="gr-plan">
      <span class="gr-plan-label">计划</span>
      <el-tag size="small" effect="plain" type="success">新建 {{ report.summary.create }}</el-tag>
      <el-tag size="small" effect="plain" type="primary">更新 {{ report.summary.update }}</el-tag>
      <el-tag size="small" effect="plain" type="danger">删除 {{ report.summary.delete }}</el-tag>
      <el-tag size="small" effect="plain" type="warning">冲突 {{ report.summary.conflict }}</el-tag>
      <el-tag size="small" effect="plain" type="info">保留 {{ report.summary.unchanged }}</el-tag>
    </div>

    <div class="gr-meta">
      <span class="gr-meta-item">耗时 {{ formatElapsed(report.elapsedMs) }}</span>
      <span class="gr-meta-item">工程 {{ report.projectName }}</span>
      <el-tag :type="report.manifestWritten ? 'success' : 'info'" size="small" effect="plain">
        manifest {{ report.manifestWritten ? '已写入' : '未写入' }}
      </el-tag>
      <el-tooltip
        v-if="canRevealTarget"
        content="desktop.ts 当前没有打开目录/在文件管理器中显示的命令，待核实后再接线"
        placement="top"
      >
        <span class="gr-reveal-wrap">
          <el-button size="small" :icon="FolderOpened" disabled>打开所在目录（待核实）</el-button>
        </span>
      </el-tooltip>
    </div>

    <el-alert
      v-for="(note, i) in notes"
      :key="'note' + i"
      class="gr-alert"
      type="warning"
      :closable="false"
      show-icon
      :title="note"
    />

    <el-alert
      v-if="warnings.length > 0"
      class="gr-alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`导出前已确认 ${warnings.length} 条警告`"
    >
      <ul class="gr-warning-list">
        <li v-for="(w, i) in warnings" :key="'warn' + i">{{ w }}</li>
      </ul>
    </el-alert>

    <div class="gr-files">
      <div class="gr-files-head">
        <span class="gr-files-title">文件明细（按 action 分组）</span>
        <span v-if="report.files.length > 0" class="gr-files-count">共 {{ report.files.length }} 个</span>
      </div>
      <p v-if="groups.length === 0" class="gr-empty">没有文件明细</p>
      <el-collapse v-else v-model="openGroups">
        <el-collapse-item v-for="g in groups" :key="g.action" :name="g.action">
          <template #title>
            <el-tag :type="g.type" size="small" effect="plain" class="gr-group-tag">{{ g.label }}</el-tag>
            <span class="gr-group-title">{{ g.files.length }} 个文件</span>
          </template>
          <code
            v-for="f in g.files.slice(0, MAX_FILES_PER_ACTION)"
            :key="f.path"
            class="gr-path"
          >{{ f.path }}</code>
          <p v-if="g.files.length > MAX_FILES_PER_ACTION" class="gr-more">
            仅显示前 {{ MAX_FILES_PER_ACTION }} 个，共 {{ g.files.length }} 个
          </p>
        </el-collapse-item>
      </el-collapse>
      <p class="gr-hint">
        逐文件 action 为导出计划的判定结果；冲突项按最终决议执行，实际写入/跳过/备份数量以上方计数为准。
      </p>
    </div>
  </div>
</template>

<style scoped>
.generation-report {
  min-width: 0;
}
.gr-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}
.gr-icon {
  color: var(--mx-success);
  flex-shrink: 0;
  margin-top: 2px;
}
.gr-head-text {
  min-width: 0;
  flex: 1;
}
.gr-title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}
.gr-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  min-width: 0;
}
.gr-target {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mx-font-mono);
  font-size: 12px;
  color: var(--mx-text-secondary);
  background: var(--mx-bg);
  border: 1px solid var(--mx-border);
  border-radius: 4px;
  padding: 2px 6px;
}
.gr-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.gr-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 8px;
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  background: var(--mx-surface);
}
.gr-num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.gr-num.success {
  color: var(--mx-success);
}
.gr-num.danger {
  color: var(--mx-error);
}
.gr-num.warning {
  color: var(--mx-warning);
}
.gr-label {
  font-size: 11px;
  color: var(--mx-text-muted);
}
.gr-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--mx-text-muted);
}
.gr-plan {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.gr-plan-label {
  font-size: 11px;
  color: var(--mx-text-muted);
  margin-right: 2px;
}
.gr-reveal-wrap {
  display: inline-block;
}
.gr-alert {
  margin-bottom: 10px;
}
.gr-warning-list {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.6;
}
.gr-files {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  background: var(--mx-surface);
  padding: 10px 12px;
}
.gr-files-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.gr-files-title {
  font-size: 13px;
  font-weight: 600;
}
.gr-files-count {
  font-size: 11px;
  color: var(--mx-text-muted);
}
.gr-group-tag {
  margin-right: 8px;
}
.gr-group-title {
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.gr-path {
  display: block;
  font-family: var(--mx-font-mono);
  font-size: 12px;
  color: var(--mx-text-secondary);
  padding: 2px 0;
  overflow-wrap: anywhere;
}
.gr-more {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--mx-text-muted);
}
.gr-hint {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px dashed var(--mx-border);
  font-size: 11px;
  color: var(--mx-text-muted);
  line-height: 1.5;
}
.gr-empty {
  margin: 10px 0;
  font-size: 12px;
  color: var(--mx-text-muted);
}
</style>