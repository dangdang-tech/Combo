import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ComboElementSelection } from './ArtifactRenderer.js';

const ELEMENT_EDITS = [
  {
    label: '强化重点',
    instruction: '提升它在页面中的视觉层级与行动指向，但不要改变功能。',
  },
  {
    label: '收紧布局',
    instruction: '收紧它内部的间距和信息密度，让内容更利落、更容易扫读。',
  },
  {
    label: '精简文案',
    instruction: '精简这里的标题和说明文案，保留原意并让用户更快理解下一步。',
  },
  {
    label: '优化手机端',
    instruction: '只优化这个区域在手机尺寸下的布局、触控尺寸和阅读顺序。',
  },
] as const;

const ROLE_LABELS: Record<string, string> = {
  button: '操作按钮',
  heading: '标题',
  input: '输入区域',
  link: '链接',
  region: '内容区块',
  form: '表单',
};

export interface StudioInspectorProps {
  elements: ComboElementSelection[];
  selectedElement: ComboElementSelection | null;
  inspectionEnabled: boolean;
  revisionNo?: number;
  verified: boolean;
  readOnly: boolean;
  isRunning: boolean;
  isTestRunning: boolean;
  reusableTestPrompt: string;
  onToggleInspection: () => void;
  onSelectElement: (element: ComboElementSelection) => void;
  onClearSelection: () => void;
  onApplyEdit: (instruction: string) => boolean;
  onRerunTest: () => boolean;
}

function roleLabel(element: ComboElementSelection): string {
  return (element.role && ROLE_LABELS[element.role]) || element.tagName.toUpperCase();
}

function clipped(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function buildContextualStudioPrompt(
  element: ComboElementSelection,
  instruction: string,
): string {
  return [
    `请只围绕当前选中的页面元素「${element.label}」进行修改。`,
    `定位键是 data-combo-key="${element.key}"。`,
    instruction.trim(),
    '保留其它区域的内容结构与真实运行行为，并继续保留所有稳定的 data-combo-key。',
  ].join('\n');
}

export function StudioInspector({
  elements,
  selectedElement,
  inspectionEnabled,
  revisionNo,
  verified,
  readOnly,
  isRunning,
  isTestRunning,
  reusableTestPrompt,
  onToggleInspection,
  onSelectElement,
  onClearSelection,
  onApplyEdit,
  onRerunTest,
}: StudioInspectorProps) {
  const [instruction, setInstruction] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const editDisabled = readOnly || isRunning || !selectedElement;

  useEffect(() => {
    setInstruction('');
    setSubmitError(null);
  }, [selectedElement?.key]);

  const apply = (nextInstruction: string): void => {
    if (!selectedElement || editDisabled || !nextInstruction.trim()) return;
    const accepted = onApplyEdit(buildContextualStudioPrompt(selectedElement, nextInstruction));
    if (!accepted) {
      setSubmitError('当前修改仍在处理中，请完成后再应用。');
      return;
    }
    setInstruction('');
    setSubmitError(null);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    apply(instruction);
  };

  return (
    <aside className="rt-studio-inspector" aria-label="页面语义检查器">
      <header className="rt-studio-inspector__head">
        <div>
          <span>SEMANTIC INSPECTOR</span>
          <strong>页面结构</strong>
        </div>
        <button
          type="button"
          className={inspectionEnabled ? 'is-active' : ''}
          aria-pressed={inspectionEnabled}
          disabled={elements.length === 0}
          onClick={onToggleInspection}
        >
          <span aria-hidden="true">⌖</span>
          {inspectionEnabled ? '完成点选' : '画布点选'}
        </button>
      </header>

      <div className="rt-studio-inspector__scroll">
        {selectedElement ? (
          <section className="rt-studio-selection" aria-label="当前选中元素">
            <div className="rt-studio-selection__eyebrow">
              <span>正在修改</span>
              <button type="button" onClick={onClearSelection} aria-label="取消选择">
                ×
              </button>
            </div>
            <h3>{clipped(selectedElement.label, 76)}</h3>
            <div className="rt-studio-selection__meta">
              <span>{roleLabel(selectedElement)}</span>
              <code>{selectedElement.key}</code>
            </div>
            {selectedElement.text && selectedElement.text !== selectedElement.label && (
              <p>{clipped(selectedElement.text, 150)}</p>
            )}

            <div className="rt-studio-selection__actions" role="group" aria-label="元素快捷修改">
              {ELEMENT_EDITS.map((edit) => (
                <button
                  key={edit.label}
                  type="button"
                  disabled={editDisabled}
                  onClick={() => apply(edit.instruction)}
                >
                  {edit.label}
                </button>
              ))}
            </div>

            <div className="rt-studio-selection__composer">
              <textarea
                rows={3}
                value={instruction}
                disabled={editDisabled}
                placeholder={
                  readOnly ? '历史 Revision 只读' : '例如：保留内容，把这里改成更克制的卡片…'
                }
                aria-label="描述选中元素的修改"
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={handleInputKeyDown}
              />
              <button
                type="button"
                disabled={editDisabled || !instruction.trim()}
                onClick={() => apply(instruction)}
              >
                应用到此处 ↑
              </button>
            </div>
            {submitError && (
              <p className="rt-studio-selection__error" role="alert">
                {submitError}
              </p>
            )}
          </section>
        ) : (
          <section className="rt-studio-inspector__guide">
            <span aria-hidden="true">⌖</span>
            <h3>{inspectionEnabled ? '在画布上点一个区域' : '先选择要修改的地方'}</h3>
            <p>
              {inspectionEnabled
                ? '可编辑区域会出现描边。选择后可以只修改这个区块，不影响其它结构。'
                : '开启画布点选，或直接从下面的页面结构中选择。'}
            </p>
          </section>
        )}

        <section className="rt-studio-outline" aria-label="可编辑页面结构">
          <div className="rt-studio-outline__head">
            <strong>可编辑结构</strong>
            <span>{elements.length} 个</span>
          </div>
          {elements.length > 0 ? (
            <ol>
              {elements.map((element, index) => (
                <li key={`${element.key}-${index}`}>
                  <button
                    type="button"
                    className={selectedElement?.key === element.key ? 'is-selected' : ''}
                    onClick={() => onSelectElement(element)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <span>
                      <strong>{clipped(element.label, 54)}</strong>
                      <small>{roleLabel(element)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rt-studio-outline__empty">页面生成后，这里会自动识别可修改区域。</p>
          )}
        </section>
      </div>

      <footer className="rt-studio-inspector__verification">
        <div>
          <span>REVISION LOOP</span>
          <strong>
            {revisionNo ? `UI R${revisionNo}` : '等待首版'}
            {verified ? ' · 已通过' : revisionNo ? ' · 待验证' : ''}
          </strong>
          <p>
            {reusableTestPrompt
              ? `上次案例：${clipped(reusableTestPrompt, 64)}`
              : '完成一次真实任务后，可沿用同一案例验证下一版。'}
          </p>
        </div>
        {revisionNo && reusableTestPrompt && (
          <button
            type="button"
            disabled={readOnly || isRunning || isTestRunning}
            onClick={onRerunTest}
          >
            {isTestRunning ? '验证中…' : `用同案例重跑 R${revisionNo} →`}
          </button>
        )}
      </footer>
    </aside>
  );
}
