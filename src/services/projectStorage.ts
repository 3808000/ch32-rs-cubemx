// 工程持久化服务：localStorage 读写（控制器不直接做 IO）+ 自动保存订阅（M4.1 浏览器版）。
// 自动保存只写单槽 localStorage（键名与历史版本兼容）；桌面端磁盘工程库（每工程目录 +
// projects.json）属 M4 后续 TODO，届时由本文件扩展为多后端实现。
// 损坏数据静默判失败，由调用方决定是否提示。
import { watch } from 'vue'
import type { ProjectConfig } from '@/model/types'

const STORAGE_KEY = 'ch32-rs-cubemx:project'

/** 自动保存防抖间隔（M4.1：dirty 变化后 ~2s 落盘）。 */
export const AUTOSAVE_DEBOUNCE_MS = 2000

/** 最近一次写入 localStorage 的序列化快照：自动保存据此跳过无变化写盘。
 *  手动 saveProject() 也会更新，避免自动保存与 Ctrl+S 重复写入。 */
let lastSavedText: string | null = null

/** 保存配置快照。失败时抛出原始异常（存储满/隐私模式等）。 */
export function saveProject(config: ProjectConfig): void {
  const text = JSON.stringify(config)
  localStorage.setItem(STORAGE_KEY, text)
  lastSavedText = text
}

/** 读取配置快照；不存在或损坏返回 null。 */
export function loadProject(): ProjectConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      lastSavedText = null
      return null
    }
    const parsed = JSON.parse(raw) as ProjectConfig
    if (typeof parsed !== 'object' || parsed === null) {
      lastSavedText = null
      return null
    }
    // 以本服务的序列化格式作为快照基准，避免旧格式（缩进/字段顺序）导致自动保存重复写盘
    lastSavedText = JSON.stringify(parsed)
    return parsed
  } catch {
    lastSavedText = null
    return null
  }
}

/** 自动保存回调与节奏配置。 */
export interface AutosaveOptions {
  /** 防抖间隔（毫秒），默认 AUTOSAVE_DEBOUNCE_MS（2000）。 */
  debounceMs?: number
  /** 每次自动保存成功后回调；可用于同步 store.dirty/lastSavedAt（由接线方决定）。 */
  onSaved?: (savedAt: number) => void
  /** 保存失败回调（存储满/隐私模式等）。 */
  onError?: (error: unknown) => void
}

/** 自动保存订阅句柄。 */
export interface AutosaveHandle {
  /** 是否仍在运行。 */
  readonly active: boolean
  /** 最近一次自动保存成功的时间戳（毫秒）；从未保存为 null。 */
  readonly lastSavedAt: number | null
  /** 停止订阅并取消待执行的保存。 */
  stop(): void
  /** 立即尝试保存（仅当 dirty 且内容与上次写入不同）。 */
  flush(): void
}

let activeAutosave: AutosaveHandle | null = null

/**
 * 启动自动保存（幂等：重复调用返回同一句柄）。
 *
 * - 订阅 `isDirty`：false→true 时开始 2s 防抖计时，true→false（手动保存/openConfig）取消计时；
 * - 深度订阅 `getConfig`：dirty 保持 true 时的连续编辑会重新计时，保证防抖语义；
 * - 写盘前比较序列化内容，与手动 saveProject()/上次自动保存一致时跳过，避免覆盖与重复写；
 * - `onSaved` 由接线方用于把 store.dirty 置回 false / 更新 lastSavedAt（服务层不改 store）。
 *
 * 组件卸载不应调用 stop()（自动保存需跨视图存活）；仅热重载/测试或主控切换工程时停止。
 */
export function startAutosave(
  getConfig: () => ProjectConfig,
  isDirty: () => boolean,
  options: AutosaveOptions = {},
): AutosaveHandle {
  if (activeAutosave) return activeAutosave

  const delay = Number.isFinite(options.debounceMs)
    ? Math.max(0, options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS)
    : AUTOSAVE_DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let lastSavedAt: number | null = null

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 立即写盘；返回是否真正写入。 */
  function saveNow(): boolean {
    if (stopped || !isDirty()) return false
    let text: string
    let config: ProjectConfig
    try {
      config = getConfig()
      text = JSON.stringify(config)
    } catch (e) {
      options.onError?.(e)
      return false
    }
    if (text === lastSavedText) return false
    try {
      saveProject(config)
      lastSavedAt = Date.now()
      options.onSaved?.(lastSavedAt)
      return true
    } catch (e) {
      options.onError?.(e)
      return false
    }
  }

  function schedule(): void {
    cancelTimer()
    if (stopped || !isDirty()) return
    timer = setTimeout(() => {
      timer = null
      saveNow()
    }, delay)
  }

  // 配置内容变化（dirty 已为 true 时连续编辑也会重新计时）
  const stopConfigWatch = watch(
    getConfig,
    () => {
      if (isDirty()) schedule()
    },
    { deep: true, flush: 'sync' },
  )
  // dirty 开关：变脏开始计时，变干净（手动保存/openConfig）取消待执行保存
  const stopDirtyWatch = watch(
    isDirty,
    (dirty) => {
      if (dirty) schedule()
      else cancelTimer()
    },
    { immediate: true, flush: 'sync' },
  )

  // 关闭/刷新页面前兜底落盘（localStorage 同步写，可在 beforeunload 中完成）
  const onBeforeUnload = () => {
    cancelTimer()
    saveNow()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', onBeforeUnload)
  }

  const handle: AutosaveHandle = {
    get active() {
      return !stopped
    },
    get lastSavedAt() {
      return lastSavedAt
    },
    stop() {
      if (stopped) return
      stopped = true
      cancelTimer()
      stopConfigWatch()
      stopDirtyWatch()
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', onBeforeUnload)
      }
      if (activeAutosave === handle) activeAutosave = null
    },
    flush() {
      cancelTimer()
      saveNow()
    },
  }
  activeAutosave = handle
  return handle
}

/** 停止当前自动保存订阅（无订阅时无操作）。 */
export function stopAutosave(): void {
  activeAutosave?.stop()
}

/** 当前自动保存句柄（未启动为 null）。 */
export function currentAutosave(): AutosaveHandle | null {
  return activeAutosave
}