/**
 * 异步动作外壳：置忙 → 执行 → 落提示 → 收忙。
 *
 * 本包原先有 15 处手写的同一套样板（`setBusy → try → setNotice(ok/err) →
 * catch setNotice(err) → finally setBusy`），散落在 SkillCardWall、
 * ExperiencesWall、SkillCenterOverlay、MarketTab、InstalledSkillRow、
 * WorkshopTab 六处。除了重复，它们还各自带着细微差别：有的失败静默、
 * 有的成功不提示、有的忙标记全局互斥有的按条目互斥——差别没有一条是
 * 业务需要，全是复制时的手滑。
 *
 * 这里收成两个 hook：
 * - `useAction` —— 带结果提示的动作；同一实例内的动作互斥，杜绝重复提交。
 * - `useBusy`   —— 只要忙标记、不要提示的动作（刷新、轮询这类）。
 */
import { useCallback, useState } from 'react'

/** 一条动作结果提示。 */
export interface ActionNotice {
  readonly kind: 'ok' | 'error'
  readonly text: string
}

/**
 * 动作文案。`fail` 必填（失败总要说话）；`ok` 省略表示成功不落提示
 * ——列表自己会变的场景（导入、删除）再弹一次「成功」纯属噪音。
 */
export interface ActionMessages {
  readonly ok?: string
  readonly fail: string
}

/** 动作标记：一般是条目 id，也可以是 `'refresh'` 这类固定键。 */
export type ActionKey = string | number

/** `useAction` 的返回值。 */
export interface ActionState {
  /** 正在进行的动作标记；undefined 表示空闲。 */
  readonly busy: ActionKey | undefined
  /** 最近一次动作的提示。 */
  readonly notice: ActionNotice | undefined
  /** 手动写入或清空提示。 */
  readonly setNotice: (notice: ActionNotice | undefined) => void
  /**
   * 跑一个动作。已有动作在跑时直接返回（互斥）。
   * 动作返回 `false` 视为失败；`messages` 省略时完全不落提示。
   */
  readonly run: (
    key: ActionKey,
    action: () => Promise<boolean | void>,
    messages?: ActionMessages,
  ) => Promise<void>
  /** 某个条目是否正在忙（用于按钮 disabled）。 */
  readonly isBusy: (key: ActionKey) => boolean
}

/**
 * 带结果提示的异步动作外壳。
 *
 * 互斥是刻意的：这些动作都写同一个 SQLite 大脑，并发写没有意义，
 * 还会让「置忙」变成假象（按钮看着禁用，实际已有请求在飞）。
 */
export function useAction(): ActionState {
  const [busy, setBusy] = useState<ActionKey>()
  const [notice, setNotice] = useState<ActionNotice>()

  const run = useCallback(async (
    key: ActionKey,
    action: () => Promise<boolean | void>,
    messages?: ActionMessages,
  ): Promise<void> => {
    if (busy !== undefined) return
    setBusy(key)
    try {
      const ok = await action()
      if (messages === undefined) return
      if (ok === false) setNotice({ kind: 'error', text: messages.fail })
      else if (messages.ok !== undefined) setNotice({ kind: 'ok', text: messages.ok })
    } catch (err) {
      if (messages === undefined) return
      // 动作可以 throw 来附带具体原因（比如导入失败是「格式错误」还是「路径不存在」），
      // 拼在通用失败文案后面——统一外壳不该以吞掉这些信息为代价。
      const detail = err instanceof Error && err.message !== '' ? ` ${err.message}` : ''
      setNotice({ kind: 'error', text: `${messages.fail}${detail}` })
    } finally {
      setBusy(undefined)
    }
  }, [busy])

  const isBusy = useCallback((key: ActionKey): boolean => busy === key, [busy])

  return { busy, notice, setNotice, run, isBusy }
}

/**
 * 只要忙标记的异步动作外壳（刷新、轮询这类不需要结果提示的动作）。
 * 返回的 `run` 不吞异常，调用方自己决定要不要 catch。
 */
export function useBusy(): readonly [boolean, (action: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }, [])
  return [busy, run]
}
