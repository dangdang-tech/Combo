// STEP④ 软字段卡（F-13，§5.4.1/§5.4.3）——经验体生成、可改、可重生成、流式。
//
// 一字段四态（永不裸转圈 / 已生成不丢 / 绝不裸露错误码）：
//   - generating/pending：显骨架条（Skeleton）+ 已生成 partial 文本/数组项（边生成边显示，逐项浮现）。
//   - done：显终值；可「编辑」（改软字段→PATCH manifest）/「重新生成」（regen 单字段，不丢其它）。
//   - stuck：偏慢三退路（继续用已生成 / 只重生成本字段 / 再等等），由父层经 SlowHint 渲染（本卡只标 stuck 文案）。
//   - failed：人话错误态（ErrorState 只 userMessage + action，无 code）——两次失败转人工，单次失败可重试。
//
// 软硬一眼区分：软字段卡带「可改 / 可重生成」操作；硬字段卡（HardFieldCard）锁定无操作。
import { useState, type ReactElement } from 'react';
import { ErrorState, Skeleton } from '../../../components/index.js';
import type { SoftFieldView } from './manifestFields.js';
import { isGenerating, isDone } from './manifestFields.js';

export interface SoftFieldCardProps {
  view: SoftFieldView;
  /** 保存编辑后的软字段值（单值传 string；数组传 string[]）。 */
  onSave: (value: string | string[]) => void;
  /** 重新生成本字段（只重生成它，不丢其它，验收 选择结构化-17）。 */
  onRegenerate: () => void;
  /** failed 态「重试」= 再次重生成（累计失败 2 次后退化为 escalate 转人工，由 error.action 决定按钮）。 */
  onRetry: () => void;
  /** 是否处于重生成在途（禁用按钮防重复点）。 */
  busy?: boolean;
}

export function SoftFieldCard({
  view,
  onSave,
  onRegenerate,
  onRetry,
  busy = false,
}: SoftFieldCardProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');

  const generating = isGenerating(view.status);
  const done = isDone(view.status);
  const failed = view.status === 'failed';
  const stuck = view.status === 'stuck';

  const beginEdit = (): void => {
    setDraftText(view.isArray ? view.items.join('\n') : view.text);
    setEditing(true);
  };

  const commitEdit = (): void => {
    if (view.isArray) {
      const items = draftText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      onSave(items);
    } else {
      onSave(draftText);
    }
    setEditing(false);
  };

  return (
    <div className="cb-soft-field" data-field={view.field} data-status={view.status}>
      <div className="cb-soft-field__head">
        <span className="cb-soft-field__label">{view.label}</span>
        <span className="cb-soft-field__badge cb-soft-field__badge--soft">可改 / 可重生成</span>
      </div>

      {/* 失败态：人话错误 + 退路（重试 / 改输入 / 转人工），其余字段不受影响（不连坐）。 */}
      {failed && view.error ? (
        <ErrorState
          error={view.error}
          onRetry={onRetry}
          onChangeInput={beginEdit}
          onEscalate={onRetry}
        />
      ) : editing ? (
        <div className="cb-soft-field__editor">
          <textarea
            className="cb-soft-field__input"
            aria-label={`编辑${view.label}`}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={view.isArray ? 4 : 2}
          />
          {view.isArray && <p className="cb-soft-field__hint">每行一条。</p>}
          <div className="cb-soft-field__actions">
            <button type="button" className="cb-btn cb-btn--primary" onClick={commitEdit}>
              保存
            </button>
            <button type="button" className="cb-btn" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
      ) : generating ? (
        // 生成中：骨架条 + 已生成 partial（边生成边显示，永不裸转圈）。
        <div className="cb-soft-field__generating">
          {view.isArray ? (
            view.items.length > 0 ? (
              <ul className="cb-soft-field__items">
                {view.items.map((it, i) => (
                  <li key={i} className="cb-soft-field__item">
                    {it}
                  </li>
                ))}
              </ul>
            ) : null
          ) : view.text ? (
            <p className="cb-soft-field__partial">{view.text}</p>
          ) : null}
          <Skeleton rows={view.isArray ? 2 : 1} label={`正在生成${view.label}`} />
        </div>
      ) : done ? (
        <>
          {view.isArray ? (
            <ul className="cb-soft-field__items">
              {view.items.map((it, i) => (
                <li key={i} className="cb-soft-field__item">
                  {it}
                </li>
              ))}
            </ul>
          ) : (
            <p className="cb-soft-field__value">{view.text}</p>
          )}
          <div className="cb-soft-field__actions">
            <button type="button" className="cb-btn" onClick={beginEdit} disabled={busy}>
              编辑
            </button>
            <button type="button" className="cb-btn" onClick={onRegenerate} disabled={busy}>
              {busy ? '重新生成中…' : '重新生成'}
            </button>
          </div>
        </>
      ) : stuck ? (
        // 卡住：本卡显安抚 + 已生成 partial；三退路按钮由父层 SlowHint 统一渲染（避免重复）。
        <div className="cb-soft-field__stuck" role="status">
          <p className="cb-soft-field__stuck-hint">
            这一项生成得有点慢，可在下方选择继续 / 重生成 / 再等等。
          </p>
          {view.isArray && view.items.length > 0 && (
            <ul className="cb-soft-field__items">
              {view.items.map((it, i) => (
                <li key={i} className="cb-soft-field__item">
                  {it}
                </li>
              ))}
            </ul>
          )}
          {!view.isArray && view.text && <p className="cb-soft-field__partial">{view.text}</p>}
        </div>
      ) : (
        // 兜底（理论不达）：骨架，绝不空白。
        <Skeleton rows={1} label={`正在准备${view.label}`} />
      )}
    </div>
  );
}
