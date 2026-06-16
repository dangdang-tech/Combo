// STEP① 导入空态引导（F-10，开工总纲 §5.1）——未开始导入时的两种导入方式 + 底部说明常驻。
//
// 两种方式（§5.1.1）：
//   1. 本机直读（推荐·最全）：网页铸一次性配对码 → 终端跑一行命令 → 助手扫本机 ~/.claude / ~/.codex
//      全量原文凭码直传 → 自动建 Job。点「开始导入 →」铸码并进配对态（CommandBox）。
//   2. CURL 命令框（一键复制一行）：展示验收口径固定串（curlOneLiner，导入-03/24），供高级用户先复制后续接。
// 底部「导入说明」常驻（隐私口径：原文不落正式盘、去敏在云端、快照仅你可见，导入-17/30）。
import type { ReactElement } from 'react';

export interface ImportEmptyStateProps {
  /** 点「开始导入 →」（铸配对码并进配对态）。 */
  onStart: () => void;
  /** 铸码请求是否在途（防重复点；按钮显「准备中…」，永不裸转圈）。 */
  starting?: boolean;
}

export function ImportEmptyState({
  onStart,
  starting = false,
}: ImportEmptyStateProps): ReactElement {
  return (
    <section className="cb-import-empty" aria-label="导入你的对话历史">
      <h2 className="cb-import-empty__title">把你的对话历史导进来，我们来帮你找出可复用的能力</h2>
      <p className="cb-import-empty__lead">
        连接本机直读最全：一行命令，把 Claude / Codex
        的对话历史全量扫进来。隐私在云端抹除，原文不留底。
      </p>

      <div className="cb-import-empty__cards">
        {/* 卡 1：本机直读（推荐·最全）。 */}
        <article className="cb-import-empty__card cb-import-empty__card--primary">
          <span className="cb-import-empty__badge">推荐 · 最全</span>
          <h3 className="cb-import-empty__card-title">连接本机直读</h3>
          <p className="cb-import-empty__card-desc">
            在你电脑的终端跑一行命令，助手会扫描本机的对话历史并安全上传。不漏、不用手选目录。
          </p>
          <button
            type="button"
            className="cb-btn cb-btn--primary cb-import-empty__start"
            onClick={onStart}
            disabled={starting}
          >
            {starting ? '准备中…' : '开始导入 →'}
          </button>
        </article>

        {/* 卡 2：CURL 命令框（一键复制一行）。 */}
        <article className="cb-import-empty__card">
          <h3 className="cb-import-empty__card-title">已经熟悉命令行？</h3>
          <p className="cb-import-empty__card-desc">
            点「开始导入」后会给你一条带专属配对码的命令，复制到终端即可。下面是它的样子：
          </p>
          <pre className="cb-import-empty__curl-preview" aria-label="导入命令示例">
            <code>curl -fsSL agora.app/import | sh</code>
          </pre>
        </article>
      </div>

      {/* 底部导入说明常驻（隐私口径）。 */}
      <footer className="cb-import-empty__notes">
        <p className="cb-import-empty__notes-title">关于导入</p>
        <ul className="cb-import-empty__notes-list">
          <li>手机号、密钥等隐私在云端自动抹除，处理后才入库。</li>
          <li>原始对话不会落到正式存储，生成的原始数据快照只有你能看到。</li>
          <li>导入开始后可以关掉页面，云端继续处理，完成后回来即可看到结果。</li>
        </ul>
      </footer>
    </section>
  );
}
