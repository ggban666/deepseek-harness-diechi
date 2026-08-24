/**
 * 侧边工坊面板（sidebar.workshop）：平权技能的「工坊」从全屏中心移到这里。
 * 点击标题行展开/收起；展开后复用中心页的 WorkshopTab（已安装技能管理、
 * 新建、导入）。读取 center 共享状态里的 workshopOpen / createDraft，因此
 * 首页工坊卡片、设置里的「一键带到工坊」都能直接唤起这个面板。
 */
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillCenterInjected, WorkshopTabProps } from './SkillCenterOverlay.tsx'
import { WorkshopTab } from './SkillCenterOverlay.tsx'
import css from './SkillWorkshopPanel.module.css'

/** Props the panel binds: sidebar owner state + the shared center face. */
export type SkillWorkshopPanelProps =
  PropsRuntime<'sidebar.workshop'>
  & PropsLocale<'skill-store'>
  & InjectFace<SkillCenterInjected>

/** Render the collapsible workshop panel inside the sidebar column. */
export function SkillWorkshopPanel({
  t, useCenter, useStore, toggleWorkshop, clearWorkshopDraft,
  importSkill, removeSkill, restoreRevision, createSkill, startTraining,
}: SkillWorkshopPanelProps) {
  const state = useCenter(value => value)
  const store = useStore(value => value)
  const expanded = state.workshopOpen === true
  const copyToClipboard = async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
  }
  const workshopProps: Omit<WorkshopTabProps, 't' | 'store'> = {
    ...(state.createDraft === undefined ? {} : { createDraft: state.createDraft }),
    onDraftConsumed: clearWorkshopDraft,
    onImport: importSkill,
    onCopy: copyToClipboard,
    onRemove: removeSkill,
    onRestore: restoreRevision,
    onCreateSkill: createSkill,
    onStartTraining: startTraining,
  }

  return (
    <section className={css.panel} data-workshop-open={expanded ? 'true' : 'false'}>
      <button
        type="button"
        className={css.head}
        aria-expanded={expanded}
        onClick={toggleWorkshop}
      >
        <span className={css.headIcon} aria-hidden="true">🛠️</span>
        <span className={css.headTitle}>{t('tabWorkshop')}</span>
        <span className={expanded ? css.chevronOpen : css.chevron} aria-hidden="true">▾</span>
      </button>
      {expanded && (
        <div className={css.body}>
          <WorkshopTab
            t={t}
            store={store}
            {...workshopProps}
          />
        </div>
      )}
    </section>
  )
}
