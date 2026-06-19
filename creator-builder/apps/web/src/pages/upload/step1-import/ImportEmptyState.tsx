// STEP① 导入空态引导（F-10，开工总纲 §5.1 / BUG-013）——主路径「从浏览器导入」+ 高级入口（本机直读 / CURL）。
//
// 主路径（BUG-013）：普通用户直接在浏览器选文件/目录或拖拽导入（BrowserImportCard，走 B-20 直传，标「推荐」）。
// 高级入口（兜底，保留不删）：
//   1. 一键导入（本机直读）：网页铸一次性配对码 → 终端跑一行命令 → 助手扫本机 ~/.claude / ~/.codex 全量原文
//      凭码直传 → 自动建 Job。点「开始导入 →」铸码并进配对态（CommandBox，导入-02/25）。
//   2. CURL 命令导入（一键复制一行）：展示验收口径固定串（curlOneLiner，导入-03/24），供高级用户先复制后续接。
// 底部「导入说明」常驻（隐私口径：完整上传到云端、云端解析去敏，导入-04/17/30）。
import { useState, type ReactElement } from 'react';
import './browser-import.css';
import { BrowserImportCard } from './BrowserImportCard.js';

export interface ImportEmptyStateProps {
  /** 浏览器导入：选了文件/目录或拖拽落区（上层交 useBrowserImport 编排）。 */
  onFiles: (files: File[]) => void;
  /** 浏览器编排在途时禁用浏览器入口（防重复触发）。 */
  uploading?: boolean;
  /** 点「开始导入 →」（高级入口：铸配对码并进配对态）。 */
  onStart: () => void;
  /** 铸码请求是否在途（防重复点；按钮显「准备中…」，永不裸转圈）。 */
  starting?: boolean;
}

export function ImportEmptyState({
  onFiles,
  uploading = false,
  onStart,
  starting = false,
}: ImportEmptyStateProps): ReactElement {
  // 高级入口默认折叠（普通用户主路径是浏览器导入；命令行/CURL 是兜底，导入-02/03）。
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <section className="cb-import-empty" aria-label="导入你的对话历史">
      <h2 className="cb-import-empty__title">把对话历史，变成可发布的能力</h2>

      <div className="cb-import-empty__cards">
        {/* 主卡：从浏览器导入（BUG-013，普通用户主路径，标「推荐」）。 */}
        <BrowserImportCard onFiles={onFiles} disabled={uploading} />
      </div>

      {/* 高级入口（兜底，保留不删）：本机直读 / CURL，默认折叠。 */}
      <div className="cb-import-empty__advanced">
        <button
          type="button"
          className="cb-link cb-import-empty__advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? '收起高级导入方式' : '试试其它导入方式（命令行 / CURL）'}
        </button>

        {advancedOpen && (
          <div className="cb-import-empty__cards" data-advanced="true">
            {/* 高级卡 1：一键导入（本机直读）。 */}
            <article className="cb-import-empty__card">
              <h3 className="cb-import-empty__card-title">一键导入（本机直读）</h3>
              <p className="cb-import-empty__card-desc">
                直接扫描这台机器上全部 ~/.claude、~/.codex —— 全自动，无需选文件夹，不会漏。
              </p>
              <button
                type="button"
                className="cb-btn cb-import-empty__start"
                onClick={onStart}
                disabled={starting}
              >
                {starting ? '准备中…' : '开始导入 →'}
              </button>
            </article>

            {/* 高级卡 2：CURL 命令导入（一键复制一行）。 */}
            <article className="cb-import-empty__card">
              <h3 className="cb-import-empty__card-title">CURL 命令导入</h3>
              <p className="cb-import-empty__card-desc">
                复制一行命令到终端运行，程序化全量扫描你本机全部历史并上传。一个文件夹都不用选。
              </p>
              <pre className="cb-import-empty__curl-preview" aria-label="导入命令示例">
                <code>curl -fsSL agora.app/import | sh</code>
              </pre>
            </article>
          </div>
        )}
      </div>

      {/* 底部导入说明常驻（隐私口径，导入-04/29：完整上传到云端、云端解析去敏）。 */}
      <footer className="cb-import-empty__notes">
        <p className="cb-import-empty__notes-title">导入说明</p>
        <p className="cb-import-empty__notes-text">
          导入会把你选择的对话历史完整上传到云端，由云端解析、去敏后再用于后续步骤。
        </p>
      </footer>
    </section>
  );
}
