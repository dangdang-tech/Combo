import { ArrowRight, Send, Sparkles } from 'lucide-react';

export type ReadingMode = 'standard' | 'deep';
export type Usage = { id: string; question: string; cost: number; mode: ReadingMode };

export default function PaymentQuestion({
  question,
  mode,
  balance,
  insufficient,
  lastUsage,
  onQuestion,
  onMode,
  onSend,
  onRecharge,
}: {
  question: string;
  mode: ReadingMode;
  balance: number;
  insufficient: boolean;
  lastUsage: Usage | null;
  onQuestion: (value: string) => void;
  onMode: (value: ReadingMode) => void;
  onSend: () => void;
  onRecharge: () => void;
}) {
  const cost = mode === 'standard' ? 2 : 20;
  return (
    <section className="gpay-conversation" aria-labelledby="question-title">
      <div className="gpay-conversation-heading">
        <p className="gpay-eyebrow">YOUR CONVERSATION · 问事对话</p>
        <h1 id="question-title">沿着你的问题，慢慢看清。</h1>
        <p className="gpay-muted">
          我的命盘 <span>／</span> 事业与选择
        </p>
      </div>
      <div className="gpay-chat-context">
        <span className="gpay-chat-avatar" aria-hidden="true">
          观
        </span>
        <div>
          <h2>观照</h2>
          <p>想换一个方向，先不急着下结论。你可以从正在考虑的选择开始，聊聊最在意什么。</p>
          <p className="gpay-muted">命盘、前文和你的问题，会在这里连在一起。</p>
        </div>
      </div>
      {lastUsage && (
        <div className="gpay-chat-answer" aria-live="polite">
          <p className="gpay-sent-question">{lastUsage.question}</p>
          <div className="gpay-chat-context">
            <span className="gpay-chat-avatar" aria-hidden="true">
              观
            </span>
            <div>
              <h2>
                观照 <small>模拟解读</small>
              </h2>
              <p>
                可以先把稳定收入和学习成长分开比较：具体职责、薪酬结构、带教资源，以及你愿意接受的变化。把这些条件核实后，再决定下一步。
              </p>
            </div>
          </div>
        </div>
      )}
      <form
        className="gpay-composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <label className="gpay-sr-only" htmlFor="gpay-question">
          你的问题
        </label>
        <textarea
          id="gpay-question"
          value={question}
          onChange={(event) => onQuestion(event.target.value)}
          placeholder="接着聊聊，你现在最关心什么？"
          rows={3}
          maxLength={2000}
        />
        <div className="gpay-composer-toolbar">
          <div className="gpay-reading-modes" aria-label="解读方式">
            <button
              type="button"
              aria-pressed={mode === 'standard'}
              onClick={() => onMode('standard')}
            >
              标准
            </button>
            <button type="button" aria-pressed={mode === 'deep'} onClick={() => onMode('deep')}>
              <Sparkles size={13} />
              深入
            </button>
          </div>
          <button
            className="gpay-button gpay-send"
            type="submit"
            disabled={!question.trim()}
            aria-label={`发送，消耗 ${cost} 点`}
          >
            <Send size={15} /> 发送 <span className="gpay-send-cost">· {cost} 点</span>
          </button>
        </div>
        {insufficient && (
          <div className="gpay-inline-insufficient" role="status">
            <span>还差 {Math.max(0, cost - balance)} 点，问题已保留。</span>
            <button type="button" onClick={onRecharge}>
              去充值 <ArrowRight size={14} />
            </button>
          </div>
        )}
      </form>
      <p className="gpay-conversation-foot">文化研究与娱乐参考 · 现实选择，以你的经历与条件为准</p>
    </section>
  );
}
