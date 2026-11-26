<script setup lang="ts">
// M19：BLE 单实例工作区。BLE 不是 AF 引脚外设，配置复用 store.ble / features.ble；
// 实例、后端与资源占用来自 data/devices/<chip>/peripherals.json 的 ble 节。
import { computed } from 'vue'
import { ArrowLeft, Document, Setting } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { BLE_NAME_BUDGET } from '@/model/conflicts/rules/bleRules'
import type { BleConfig } from '@/model/types'
import StatusBadge from '@/components/common/StatusBadge.vue'

const props = defineProps<{ id: string }>()

const store = useProjectStore()
const cap = computed(() => store.deviceData.peripherals.ble)
const active = computed(() => store.features.ble)

/** GAP 设备名硬上限（GAP_DEVICE_NAME_LEN / 模板 BLE_NAME_MAX_BYTES）。 */
const BLE_GAP_NAME_MAX = 248

const nameBytes = computed(() => new TextEncoder().encode(store.ble.deviceName ?? '').length)
const nameBudget = computed(() => BLE_NAME_BUDGET[store.ble.role])
const nameTooLong = computed(
  () => nameBytes.value > nameBudget.value || nameBytes.value > BLE_GAP_NAME_MAX,
)

const ROLE_DESC: Record<string, string> = {
  peripheral: '可连接从机：广播 + 简单 GATT 服务（read/notify + write）',
  broadcaster: '只广播不连接：adv 短名 + 厂商数据 + 扫描响应完整名',
  observer: '只扫描不连接：打印对端地址/RSSI 并周期重扫',
}

const roleOptions = computed(() =>
  (cap.value?.roles ?? []).map((role) => ({
    value: role as BleConfig['role'],
    label: role,
    desc: ROLE_DESC[role] ?? '',
  })),
)
const roleDesc = computed(() => roleOptions.value.find((o) => o.value === store.ble.role)?.desc ?? '')

const backends = computed(() => cap.value?.backends ?? [])
const backend = computed(() => store.ble.backend ?? 'shim')

const macOptions: { value: BleConfig['macSource']; label: string; desc: string }[] = [
  { value: 'factory', label: '出厂 MAC（推荐）', desc: '读取 ISP ROM 中的唯一地址' },
  { value: 'default', label: 'HAL 固定值', desc: '11:22:33:44:55:66（仅调试）' },
  { value: 'custom', label: '自定义', desc: '按人读序生成 MacAddress::from_msb' },
]
const macDesc = computed(() => macOptions.find((o) => o.value === store.ble.macSource)?.desc ?? '')

const docUrl = computed(() => store.deviceData.chip.docUrl || 'https://www.wch.cn/')

function setEnabled(v: boolean) {
  store.setFeatures({ ble: v, ...(v ? { embassy: true } : {}) })
  store.notify(
    v
      ? 'BLE 已启用：会占用 BLEB/BLEL 中断与 32K 低频域；PA10/PA11 保留给 LSE'
      : 'BLE 已停用：导出将移除 BLE 生成物，其余外设保持不变',
    v ? 'warning' : 'info',
  )
}

function setRole(role: BleConfig['role']) {
  store.setBle({ role })
}
function setBackend(id: string) {
  store.setBle({ backend: id as BleConfig['backend'] })
}
function setName(name: string) {
  store.setBle({ deviceName: name })
}
function setAdvInterval(v: number | undefined) {
  if (typeof v === 'number' && Number.isFinite(v)) store.setBle({ advIntervalMs: v })
}
function setScanMs(v: number | undefined) {
  if (typeof v === 'number' && Number.isFinite(v)) store.setBle({ scanMs: v })
}
function setActiveScan(v: boolean) {
  store.setBle({ activeScan: v })
}
function setMacSource(source: BleConfig['macSource']) {
  store.setBle({ macSource: source })
}
function setCustomMac(mac: string) {
  store.setBle({ mac: mac })
}
function setClock32k(v: 'lse' | 'lsi') {
  store.setBle({ clock32k: v })
}

/** UUID16 显示为 0xFFE0；解析接受带/不带 0x 前缀的十六进制。 */
function fmtUuid(n: number): string {
  return `0x${(n & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`
}
function setUuid(field: 'serviceUuid16' | 'notifyUuid16' | 'writeUuid16', text: string) {
  const n = Number.parseInt(String(text).trim().replace(/^0x/i, ''), 16)
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    store.notify(`UUID16 非法：${text}（需 0x0000–0xFFFF）`, 'warning')
    return
  }
  store.setBle({ [field]: n } as Partial<BleConfig>)
}
</script>

<template>
  <div class="ws-view ble-ws">
    <div class="ws-head">
      <div class="ws-head-left">
        <button type="button" class="ws-back" @click="store.closePeripheral()">
          <el-icon :size="13"><ArrowLeft /></el-icon>
          Back to list
        </button>
        <div class="ws-title">
          <div class="ws-category">{{ cap?.category ?? 'Wireless' }}</div>
          <div class="ws-name">{{ props.id }}</div>
        </div>
        <StatusBadge :active="active" />
        <el-tag size="small" type="info">片上外设 · 无 AF 引脚</el-tag>
      </div>
      <div class="ws-head-right">
        <a class="doc-link" :href="docUrl" target="_blank" rel="noopener">
          <el-icon :size="13"><Document /></el-icon> Open documentation
        </a>
        <el-button v-if="active" type="danger" plain size="small" @click="setEnabled(false)">
          Deactivate
        </el-button>
      </div>
    </div>

    <div v-if="!cap" class="ble-missing">
      <el-alert type="error" :closable="false" title="该芯片未声明 BLE 能力" />
    </div>

    <div v-else class="ble-body">
      <div v-if="!active" class="ble-activation">
        <el-alert
          type="info"
          :closable="false"
          title="BLE Not Configured"
          description="启用后使用 busy-poll 运行时，并占用 BLEB/BLEL 中断与 32K 低频域。"
        />
        <el-button type="primary" @click="setEnabled(true)">Enable BLE</el-button>
      </div>

      <template v-else>
        <section class="ble-card">
          <h3 class="ble-card-title">GAP</h3>
          <div class="ble-rows">
            <div class="ble-row">
              <div class="ble-label">角色</div>
              <div class="ble-value">
                <el-radio-group :model-value="store.ble.role" size="small" @change="setRole($event as BleConfig['role'])">
                  <el-radio-button v-for="opt in roleOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </el-radio-button>
                </el-radio-group>
                <span class="ble-note">{{ roleDesc }}</span>
              </div>
            </div>
            <div class="ble-row">
              <div class="ble-label">设备名</div>
              <div class="ble-value">
                <el-input
                  :model-value="store.ble.deviceName"
                  size="small"
                  style="width: 240px"
                  placeholder="CH582M"
                  @input="setName($event)"
                />
                <span class="ble-note" :class="{ 'ble-warn': nameTooLong }">
                  UTF-8 {{ nameBytes }} 字节（{{ store.ble.role }} 上限 {{ nameBudget }} 字节；GAP 上限
                  {{ BLE_GAP_NAME_MAX }}）
                </span>
              </div>
            </div>
            <div class="ble-row">
              <div class="ble-label">广播间隔</div>
              <div class="ble-value">
                <el-input-number
                  :model-value="store.ble.advIntervalMs"
                  size="small"
                  :min="20"
                  :max="10240"
                  :step="10"
                  @change="setAdvInterval($event)"
                />
                <span class="ble-note">ms（生成换算 0.625ms 单位）</span>
              </div>
            </div>
            <div class="ble-row">
              <div class="ble-label">32K 时钟源</div>
              <div class="ble-value">
                <el-radio-group :model-value="store.ble.clock32k ?? 'lse'" size="small" @change="setClock32k($event as 'lse' | 'lsi')">
                  <el-radio-button value="lse">LSE 外部晶振</el-radio-button>
                  <el-radio-button value="lsi">LSI 内部</el-radio-button>
                </el-radio-group>
                <span class="ble-note">
                  {{ (store.ble.clock32k ?? 'lse') === 'lse'
                    ? '缺省：32.768kHz 晶振；PA10/PA11 保留'
                    : '无晶振板回退；LSI 校准未移植，连接稳定性未保证' }}
                </span>
              </div>
            </div>
            <div class="ble-row">
              <div class="ble-label">MAC 来源</div>
              <div class="ble-value">
                <el-select
                  :model-value="store.ble.macSource"
                  size="small"
                  style="width: 190px"
                  @change="setMacSource($event as BleConfig['macSource'])"
                >
                  <el-option v-for="opt in macOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
                <span class="ble-note">{{ macDesc }}</span>
                <el-input
                  v-if="store.ble.macSource === 'custom'"
                  :model-value="store.ble.mac ?? ''"
                  size="small"
                  style="width: 200px"
                  placeholder="AA:BB:CC:DD:EE:FF"
                  @change="setCustomMac($event)"
                />
              </div>
            </div>
            <div v-if="store.ble.role === 'peripheral'" class="ble-row">
              <div class="ble-label">GATT UUID16</div>
              <div class="ble-value">
                <span class="ble-note">服务</span>
                <el-input :model-value="fmtUuid(store.ble.serviceUuid16)" size="small" style="width: 96px" @change="setUuid('serviceUuid16', $event)" />
                <span class="ble-note">notify</span>
                <el-input :model-value="fmtUuid(store.ble.notifyUuid16)" size="small" style="width: 96px" @change="setUuid('notifyUuid16', $event)" />
                <span class="ble-note">write</span>
                <el-input :model-value="fmtUuid(store.ble.writeUuid16)" size="small" style="width: 96px" @change="setUuid('writeUuid16', $event)" />
              </div>
            </div>
            <div v-if="store.ble.role === 'observer'" class="ble-row">
              <div class="ble-label">扫描</div>
              <div class="ble-value">
                <el-input-number
                  :model-value="store.ble.scanMs"
                  size="small"
                  :min="1"
                  :max="10240"
                  :step="100"
                  @change="setScanMs($event)"
                />
                <span class="ble-note">ms 扫描窗口</span>
                <el-checkbox :model-value="store.ble.activeScan" size="small" @change="setActiveScan($event === true)">
                  主动扫描
                </el-checkbox>
              </div>
            </div>
          </div>
        </section>

        <section class="ble-card">
          <h3 class="ble-card-title">后端与资源</h3>
          <div class="ble-rows">
            <div class="ble-row">
              <div class="ble-label">生成后端</div>
              <div class="ble-value ble-backends">
                <el-radio-group :model-value="backend" size="small" @change="setBackend($event as string)">
                  <el-radio-button v-for="b in backends" :key="b.id" :value="b.id" :disabled="!b.exportable">
                    {{ b.label }}
                  </el-radio-button>
                </el-radio-group>
                <div v-for="b in backends" :key="`${b.id}-note`" class="ble-backend">
                  <span class="ble-backend-name">{{ b.label }}</span>
                  <el-tag size="small" :type="b.exportable ? 'success' : 'info'">
                    {{ b.exportable ? '可导出' : '接入中' }}
                  </el-tag>
                  <span v-if="b.notes" class="ble-note">{{ b.notes }}</span>
                </div>
              </div>
            </div>
            <div class="ble-row">
              <div class="ble-label">中断</div>
              <div class="ble-value">
                <code v-for="irq in cap.interrupts" :key="irq" class="ble-res">{{ irq }}</code>
                <span class="ble-note">BLE 启用时不可禁用（NVIC 面板中的同名项）</span>
              </div>
            </div>
            <div v-if="cap.timers?.length" class="ble-row">
              <div class="ble-label">LLE 计时器</div>
              <div class="ble-value">
                <code v-for="t in cap.timers" :key="t" class="ble-res">{{ t }}</code>
                <span class="ble-note">协议栈内部占用，不对应用户 TMR 外设</span>
              </div>
            </div>
            <div class="ble-row">
              <div class="ble-label">前置条件</div>
              <div class="ble-value">
                <el-tag v-if="cap.requires?.lse" size="small">LSE 32.768kHz</el-tag>
                <el-tag v-if="cap.requires?.embassy" size="small">embassy 运行时</el-tag>
                <span class="ble-note">PA10/PA11 保留给 LSE，禁止再分配</span>
              </div>
            </div>
            <div v-if="cap.notes" class="ble-row">
              <div class="ble-label">说明</div>
              <div class="ble-value"><span class="ble-note">{{ cap.notes }}</span></div>
            </div>
          </div>
          <div class="ble-actions">
            <el-button size="small" :icon="Setting" @click="store.setView('project-settings')">
              Open Project Settings · BLE
            </el-button>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ble-ws {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ble-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ble-activation {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
}
.ble-card {
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: 10px;
  padding: 14px 16px 8px;
}
.ble-card-title {
  margin: 0 0 10px;
  font-size: var(--mx-fz-body);
  font-weight: 600;
  color: var(--mx-text);
}
.ble-rows {
  display: flex;
  flex-direction: column;
}
.ble-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 8px 0;
  border-top: 1px solid var(--mx-border);
}
.ble-row:first-child {
  border-top: none;
}
.ble-label {
  font-size: var(--mx-fz-body);
  color: var(--mx-text-secondary);
  padding-top: 2px;
}
.ble-value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: var(--mx-fz-body);
  color: var(--mx-text);
}
.ble-note {
  font-size: 11px;
  color: var(--mx-text-muted);
  line-height: 1.5;
}
.ble-warn {
  color: var(--mx-danger, #c45656);
}
.ble-res {
  font-family: var(--mx-font-mono);
  font-size: 11px;
  background: var(--mx-surface-alt, #f5f6f8);
  border: 1px solid var(--mx-border);
  border-radius: 4px;
  padding: 1px 6px;
}
.ble-backends {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.ble-backend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ble-backend-name {
  font-family: var(--mx-font-mono);
  font-size: 11px;
}
.ble-actions {
  padding: 10px 0 6px;
}
.ble-missing {
  padding: 18px 22px;
}
</style>