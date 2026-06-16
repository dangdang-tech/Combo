// 草稿与上传中条（外壳首页-16/17/23/33/34，F-15）。
//
// 横向胶囊，列未完成上传任务 + 所处步骤 + 进度（「结构化中 60%」）。每条独立、各回各的断点：
// 点「去上传流程 →」→ 读 currentStep 映射五步路由，恢复到精确断点（不串台，外壳首页-34）。
// 进度/步骤由后端 DraftView 单源（currentStep + stepProgress.phrase），前端不另算。
// 空态（外壳首页-23）：无 active 草稿 → 不出空白胶囊（上层 hasDrafts 判定后不渲染本条）。
import type { ReactElement } from 'react';
import type { DraftView, DraftStep } from '@cb/shared';
import { CREATE_STEPS } from '../../shell/routes.js';

export interface DraftStripProps {
  drafts: DraftView[];
  /** 点「去上传流程」→ 跳到该草稿 currentStep 对应路由（精确断点恢复）。 */
  onResume: (draft: DraftView, path: string) => void;
}

/** 五步序号（用于胶囊上「STEP③」标识，与 CREATE_STEPS 顺序一致）。 */
const STEP_INDEX: Record<DraftStep, number> = {
  import: 1,
  extract: 2,
  select: 3,
  structure: 4,
  publish: 5,
};

/** currentStep → 五步路由（CREATE_STEPS 单源；缺映射兜底进第一步）。 */
function pathForStep(step: DraftStep): string {
  return (
    CREATE_STEPS.find((s) => s.step === step)?.path ?? CREATE_STEPS[0]?.path ?? '/create/import'
  );
}

function DraftCapsule({
  draft,
  onResume,
}: {
  draft: DraftView;
  onResume: (draft: DraftView, path: string) => void;
}): ReactElement {
  const path = pathForStep(draft.currentStep);
  const pct = Math.min(100, Math.max(0, draft.stepProgress.percent));
  const stepLabel =
    CREATE_STEPS.find((s) => s.step === draft.currentStep)?.label ?? draft.currentStep;
  return (
    <li className="cb-draft-capsule" data-draft={draft.id} data-step={draft.currentStep}>
      <div className="cb-draft-capsule__head">
        <span className="cb-draft-capsule__step" aria-hidden="true">
          STEP{STEP_INDEX[draft.currentStep]}
        </span>
        <span className="cb-draft-capsule__title">{draft.title ?? '未命名草稿'}</span>
      </div>
      {/* 进度 + 人话短语（后端单源 stepProgress.phrase，如「结构化中 60%」）。 */}
      <div className="cb-draft-capsule__progress" aria-label={`${stepLabel} ${pct}%`}>
        <div
          className="cb-draft-capsule__track"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="cb-draft-capsule__fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="cb-draft-capsule__phrase">{draft.stepProgress.phrase}</span>
      </div>
      <button
        type="button"
        className="cb-draft-capsule__resume"
        onClick={() => onResume(draft, path)}
      >
        去上传流程 →
      </button>
    </li>
  );
}

export function DraftStrip({ drafts, onResume }: DraftStripProps): ReactElement | null {
  // 空态：无草稿不出空白胶囊（外壳首页-23）。
  if (drafts.length === 0) return null;
  return (
    <section className="cb-draft-strip" aria-label="草稿与上传中">
      <h3 className="cb-draft-strip__title">草稿与上传中</h3>
      <ul className="cb-draft-strip__list">
        {drafts.map((d) => (
          <DraftCapsule key={d.id} draft={d} onResume={onResume} />
        ))}
      </ul>
    </section>
  );
}
