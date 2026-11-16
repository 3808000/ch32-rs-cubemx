<script setup lang="ts">
// 引脚分组面板（右面板 tab）：创建分组 / 引脚归属（单归属）/ 颜色。
// 分组操作走 lib/groups 纯函数，结果整体写回 store.groups。
import { computed, reactive, ref } from 'vue'
import { CollectionTag, Delete, Plus } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { addToGroup, createGroup, GROUP_COLORS, removeFromGroup } from '@/model/pins/groups'
import EmptyState from './common/EmptyState.vue'

const store = useProjectStore()

const newName = ref('')
// 每组待添加引脚选择
const addingPin = reactive<Record<string, string>>({})

const groups = computed(() => store.groups)

const ioPins = computed(() => store.deviceData.chip.pins.filter((p) => p.type === 'IO').map((p) => p.name))

function commit(next: typeof store.groups) {
  store.groups = next
  store.markDirty()
}

function create() {
  const name = newName.value.trim()
  if (!name) return
  commit(createGroup(store.groups, name))
  newName.value = ''
}

function addPin(name: string) {
  const pin = addingPin[name]
  if (!pin) return
  commit(addToGroup(store.groups, name, pin))
  addingPin[name] = ''
}

function removePin(pin: string) {
  commit(removeFromGroup(store.groups, pin))
}

function removeGroup(name: string) {
  store.removeGroup(name)
}

function setColor(name: string, color: string) {
  commit(store.groups.map((g) => (g.name === name ? { ...g, color } : g)))
}

function colorOf(color: string | undefined, index: number): string {
  return color ?? GROUP_COLORS[index % GROUP_COLORS.length]
}
</script>

<template>
  <div class="groups-panel">
    <!-- 创建分组 -->
    <div class="gp-create">
      <el-input v-model="newName" size="small" placeholder="新分组名称" @keyup.enter="create" />
      <el-button size="small" type="primary" :icon="Plus" :disabled="!newName.trim()" @click="create">创建分组</el-button>
    </div>

    <!-- 分组列表 -->
    <div v-for="(g, i) in groups" :key="g.name" class="gp-group">
      <div class="gp-head">
        <span class="gp-dot" :style="{ background: colorOf(g.color, i) }" />
        <span class="gp-name">{{ g.name }}</span>
        <span class="gp-count">{{ g.pins.length }} 引脚</span>
        <el-button size="small" text type="danger" :icon="Delete" @click="removeGroup(g.name)">删除组</el-button>
      </div>
      <div class="gp-pins">
        <el-tag
          v-for="pin in g.pins"
          :key="pin"
          size="small"
          closable
          :color="colorOf(g.color, i)"
          class="gp-pin-tag"
          @close="removePin(pin)"
        >
          {{ pin }}
        </el-tag>
        <span v-if="g.pins.length === 0" class="gp-empty">暂无引脚</span>
      </div>
      <div class="gp-add">
        <el-select
          v-model="addingPin[g.name]"
          size="small"
          placeholder="添加引脚"
          class="gp-add-select"
          filterable
          @change="addPin(g.name)"
        >
          <el-option v-for="p in ioPins" :key="p" :label="p" :value="p" />
        </el-select>
      </div>
      <!-- 颜色切换 -->
      <div class="gp-colors">
        <button
          v-for="c in GROUP_COLORS"
          :key="c"
          type="button"
          class="gp-swatch"
          :class="{ current: colorOf(g.color, i) === c }"
          :style="{ background: c }"
          :title="c"
          @click="setColor(g.name, c)"
        />
      </div>
    </div>

    <EmptyState
      v-if="groups.length === 0"
      :icon="CollectionTag"
      title="暂无分组"
      description="创建分组后可把相关引脚归类（一个引脚只属于一个组）"
    />
  </div>
</template>

<style scoped>
.groups-panel {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gp-create {
  display: flex;
  gap: 8px;
}
.gp-create .el-input {
  flex: 1;
}
.gp-group {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-button);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gp-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gp-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}
.gp-name {
  font-size: var(--mx-fz-body);
  font-weight: 600;
  color: var(--mx-text);
}
.gp-count {
  font-size: 11px;
  color: var(--mx-text-muted);
  margin-right: auto;
}
.gp-head .el-button {
  margin: 0;
}
.gp-pins {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.gp-pin-tag {
  border: none;
  color: #fff;
  font-family: var(--mx-font-mono);
}
.gp-empty {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
}
.gp-add-select {
  width: 140px;
}
.gp-colors {
  display: flex;
  gap: 6px;
}
.gp-swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.gp-swatch.current {
  border-color: var(--mx-text);
}
</style>
