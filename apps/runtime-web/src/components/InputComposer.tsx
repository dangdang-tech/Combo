// 输入框：Enter 发送 / Shift+Enter 换行；生成中禁发并露出打断按钮。
import { useState, type KeyboardEvent } from 'react';

export interface InputComposerProps {
  disabled: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export function InputComposer({ disabled, onSend, onInterrupt }: InputComposerProps) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="rt-composer">
      <div className="rt-composer__row">
        <textarea
          className="rt-composer__input"
          placeholder="描述你想要的产出（Enter 发送，Shift+Enter 换行）"
          value={text}
          disabled={disabled}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="rt-btn rt-btn--accent rt-composer__send"
          disabled={disabled || text.trim().length === 0}
          onClick={submit}
        >
          {disabled ? '生成中…' : '发送'}
        </button>
        {disabled && (
          <button type="button" className="rt-btn rt-composer__send" onClick={onInterrupt}>
            打断
          </button>
        )}
      </div>
    </div>
  );
}
