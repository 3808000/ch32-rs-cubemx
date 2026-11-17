// 工程持久化服务：localStorage 读写（控制器不直接做 IO）+ 自动保存订阅。
// - 浏览器：单槽 localStorage（键名与历史版本兼容，行为逐字节不变）；
// - 桌面端（M10）：磁盘工程库，cube.json 写入当前工程目录，并同步索引 projects.json；
//   同时写一份单槽 localStorage 影子快照，保证启动时 controller.restore() 仍可同步恢复。
// 损坏数据静默判失败，由调用方决定是否提示。
import { watch } from 'vue'
import type { ProjectConfig } from '@/model/types'
import { isDesktopApp, readTextFileNative, writeTextFileNative } from '@/services/desktop'
import {
  joinFsPath,
  listLibraryDisk,
  saveProjectEntryDisk,
  selectRecentEntries,
} from '@/services/recentProjects'

const STORAGE_KEY = 'ch32-rs-cubemx:project'

/** 自动保存防抖间隔（M4.1：dirty 变化后 ~2s 落盘）。 */
export const AUTOSAVE_DEBOUNCE_MS = 2000

/** 最近一次写入 json 的序列化快照：自动保存据此跳过无变化写盘。
 *  手动 saveProject() 也会更新，避免自动保存与 Ctrl+S 重复写入。 */
let lastSavedText: string | null = null

// ---------- 桌面磁盘后端状态（M10） ----------

/** 当前工程磁盘目录（桌面端）；null = 尚未绑定（浏览器始终为 null）。 */
let activeProjectDir: string | null = null

/** 桌面端持久化当前目录的 localStorage 键：冷启动后自动保存仍能落到原工程。 */
const PROJECT_DIR_KEY = 'ch32-rs-cubemx:project-dir'

/** 桌面端最近一次读取/写入的配置快照：供同步 loadProject() 使用。 */
let diskSnapshot: ProjectConfig | null = null

/** 磁盘异步写失败回调（由 HomeView 接线到 store.notify）。 */
let saveErrorHandler: ((error: unknown) => void) | null = null

/** 注册磁盘保存失败回调；传 null 取消。 */
export function setProjectSaveErrorHandler(handler: ((error: unknown) => void) | null): void {
  saveErrorHandler = handler
}

/** 绑定当前工程目录（打开/新建工程时调用）；null/空白视为解绑。 */
export function setCurrentProjectDir(dir: string | null): void {
  const trimmed = (dir ?? '').trim()
  activeProjectDir = trimmed || null
  // 仅桌面端持久化（浏览器 localStorage 槽位保持 M4.1 逐字节不变）
  if (!isDesktopApp()) return
  try {
    if (activeProjectDir) localStorage.setItem(PROJECT_DIR_KEY, activeProjectDir)
    else localStorage.removeItem(PROJECT_DIR_KEY)
  } catch {
    /* 存储满/隐私模式：目录绑定仅存活于本次会话 */
  }
}

/** 当前工程目录（未绑定为 null）；桌面端冷启动时从影子键恢复。 */
export function currentProjectDir(): string | null {
  if (!activeProjectDir && isDesktopApp()) {
    try {
      activeProjectDir = localStorage.getItem(PROJECT_DIR_KEY) || null
    } catch {
      activeProjectDir = null
    }
  }
  return activeProjectDir
}

function reportSaveError(error: unknown): void {
  saveErrorHandler?.(error)
}

/** 保存配置快照。失败时抛出原始异常（存储满/隐私模式等）。
 * 桌面端：写 cube.json + 索引（异步，失败走 setProjectSaveErrorHandler），并镜像单槽 localStorage。
 */
export function saveProject(config: ProjectConfig): void {
  const text = JSON.stringify(config)
  if (isDesktopApp()) {
    localStorage.setItem(STORAGE_KEY, text)
    lastSavedText = text
    diskSnapshot = config
    const dir = currentProjectDir()
    if (dir) {
      void saveProjectToDisk(config, dir).catch((e) => reportSaveError(e))
    }
    return
  }
  localStorage.setItem(STORAGE_KEY, text)
  lastSavedText = text
}

/**
 * 桌面端：把配置写入指定工程目录的 cube.json，并登记/更新磁盘索引。
 * 父目录由 Rust write_file 逐级创建（即“ensure 目录”语义）。
 */
export async function saveProjectToDisk(
  config: ProjectConfig,
  dir: string | null = null,
): Promise<void> {
  const target = (dir ?? currentProjectDir() ?? '').trim()
  if (!target) throw new Error('尚未绑定工程目录')
  const text = JSON.stringify(config)
  await writeTextFileNative(joinFsPath(target, 'cube.json'), text)
  await saveProjectEntryDisk(config, target)
  setCurrentProjectDir(target)
  diskSnapshot = config
  lastSavedText = text
  // 影子快照：App 启动时 controller.restore() 走同步 loadProject()
  try {
    localStorage.setItem(STORAGE_KEY, text)
  } catch {
    /* 磁盘写入已成功：localStorage 满时忽略影子快照失败 */
  }
}

/**
 * 桌面端：按索引 lastOpened 读取最近工程目录的 cube.json（异步）。
 * 同步 loadProject() 无法等待 invoke，因此由调用方在启动时预热快照。
 */
export async function loadProjectFromDisk(): Promise<ProjectConfig | null> {
  if (!isDesktopApp()) return null
  try {
    const entry = selectRecentEntries(await listLibraryDisk(), 1)[0]
    if (!entry) return null
    const parsed: unknown = JSON.parse(
      await readTextFileNative(joinFsPath(entry.dir, 'cube.json')),
    )
    if (typeof parsed !== 'object' || parsed === null) return null
    diskSnapshot = parsed as ProjectConfig
    setCurrentProjectDir(entry.dir)
    return diskSnapshot
  } catch {
    return null
  }
}

/**
 * 读取配置快照；不存在或损坏返回 null。
 * 桌面端优先返回已预热的磁盘快照，否则回退单槽 localStorage（兼容旧会话）。
 */
export function loadProject(): ProjectConfig | null {
  if (isDesktopApp() && diskSnapshot) {
    lastSavedText = JSON.stringify(diskSnapshot)
    return diskSnapshot
  }
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
    // 桌面端：写当前工程目录的 cube.json；尚未绑定目录时静默跳过（不写 localStorage）
    const dir = isDesktopApp() ? currentProjectDir() : null
    if (isDesktopApp() && dir) {
      void saveProjectToDisk(config, dir).then(
        () => {
          lastSavedAt = Date.now()
          options.onSaved?.(lastSavedAt)
        },
        (e) => options.onError?.(e),
      )
      return true
    }
    if (isDesktopApp()) return false
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