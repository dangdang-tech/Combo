import type { ReactElement } from 'react';
import { AgentIcon } from '../../components/AgentIcon.js';
import { CopyInstruction } from '../../components/CopyInstruction.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import './landing.css';

const PUBLIC_PLUGIN_COMMIT = 'fd6b715b216e55f46e613b0cb5845c136a0c5913';
const PUBLIC_PLUGIN_REPOSITORY = 'https://github.com/dangdang-tech/combo-plugin-distribution';

export const CODING_AGENT_CREATION_TASK = `请在当前客户端安装 Combo 0.2.0 内测插件，并把我们当前对话中已经形成的可复用方法提取成一个可审阅的 Agent。

公开发行仓库：${PUBLIC_PLUGIN_REPOSITORY}
固定提交：${PUBLIC_PLUGIN_COMMIT}
请先阅读这个固定版本的安装说明：${PUBLIC_PLUGIN_REPOSITORY}/blob/${PUBLIC_PLUGIN_COMMIT}/docs/install.md

只安装到我正在使用的 Codex 或 Claude Code。你可以自动取得并校验这份公开发行包，再调用该客户端的插件安装命令。不要要求我手工打开 Terminal。先检查已有 Combo 插件、同名 MCP 和 Skill；若已有其他来源或来源无法确认，请停止并解释，由我选择后再处理，不得覆盖、禁用或卸载旧版本。

安装后，使用你在本次当前对话里已经可用的上下文整理方法，不要读取 Project、其他任务、原始会话文件或凭据，也不要上传或公开分享。如果新安装的 MCP 工具尚未进入当前任务，就由你在当前对话整理方法，按固定版本安装说明调用它的本地编译器；不要另外启动模型或读取旧会话来恢复内容。

请展示真实编译出的完整 AGENT.md、完整 Skill 和 Package digest，说明覆盖范围；仅编译完成时不要声称已经运行。若当前上下文没有足够的方法，请告诉我插件是否已就绪，并请我在已有方法的原对话中继续提取。不要查询其他任务来补齐。`;

export function LandingPage(): ReactElement {
  useDocumentTitle('把对话，变成 Agent · Combo');
  return (
    <article className="cb-agent-landing">
      <header className="cb-agent-landing__intro">
        <h1>
          把对话，
          <wbr />
          变成 Agent。
        </h1>
        <p>复制指令，交给 Codex 或 Claude Code。</p>
        <CopyInstruction
          text={CODING_AGENT_CREATION_TASK}
          label="复制指令"
          copiedHint="已复制。粘贴到已有方法的对话，安装 Combo 并提取 Agent。"
          className="cb-agent-landing__primary"
        />
      </header>
      <figure
        className="cb-agent-landing__concept"
        aria-label="把你的对话整理成可复用的 Agent，概念示意"
      >
        <div className="cb-agent-landing__conversation">
          <div className="cb-agent-landing__bubbles" aria-hidden="true">
            <div className="cb-agent-landing__bubble">
              <i />
              <i />
            </div>
            <div className="cb-agent-landing__bubble">
              <i />
              <i />
            </div>
            <div className="cb-agent-landing__bubble">
              <i />
              <i />
            </div>
          </div>
          <span>你的对话</span>
        </div>
        <AgentIcon name="arrow" className="cb-agent-landing__arrow" />
        <div className="cb-agent-landing__result">
          <div className="cb-agent-landing__sample" aria-hidden="true">
            <span className="cb-agent-landing__emblem">
              <AgentIcon name="layers" />
            </span>
            <strong>Agent</strong>
          </div>
          <span>随时复用</span>
        </div>
      </figure>
    </article>
  );
}
