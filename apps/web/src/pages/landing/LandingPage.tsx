import type { ReactElement } from 'react';
import { AgentIcon } from '../../components/AgentIcon.js';
import { CopyInstruction } from '../../components/CopyInstruction.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import './landing.css';

const PUBLIC_PLUGIN_COMMIT = 'dcff6e60b5ec712368116371a19fd81a8843ff6a';
const PUBLIC_PLUGIN_REPOSITORY = 'https://github.com/dangdang-tech/combo-plugin-distribution';

export const CODING_AGENT_CREATION_TASK = `请在当前客户端安装 Combo 0.2.0 内测插件，并把我们当前对话中已经形成的可复用方法提取成一个可审阅的 Agent。

公开发行仓库：${PUBLIC_PLUGIN_REPOSITORY}
固定提交：${PUBLIC_PLUGIN_COMMIT}
请先阅读这个固定版本的安装说明：${PUBLIC_PLUGIN_REPOSITORY}/blob/${PUBLIC_PLUGIN_COMMIT}/docs/install.md

只安装到我正在使用的 Codex 或 Claude Code，不要要求我手工打开 Terminal。先只读清点全部已有 Combo 插件（包括 disabled）及当前任务实际可见的 MCP 和 Skill。在任何卸载之前，先匿名取得并校验固定目标包；取得或校验失败时，不得卸载旧插件。

如果存在旧 Combo 或预览来源，请列明每项精确的 plugin@marketplace、来源、版本、启用状态和影响范围；来源或影响范围无法确认时先停止，不卸载。请我明确确认具体旧项后，才使用当前客户端的官方卸载入口逐项卸载；已有针对这些具体旧项的明确授权时不重复询问。这次安装请求本身不授权卸载任意旧插件。保护 Projects、对话、源码和其他插件；禁止手动清缓存、改配置、批量卸载或强制安装，不要仅禁用旧插件来绕过冲突。

卸载后重新核对客户端清单及当前任务 MCP/Skill；有残留、来源未知或无法证明清除时，停止并说明原任务重载交接，不得用本地 CLI 绕过冲突。确认无冲突后，才按固定版本安装说明执行安装器 --apply。不要因卸载成功就声称原任务已清除旧工具，也不要擅自换新任务。

安装后，使用你在本次当前对话里已经可用的上下文整理方法，不要读取 Project、其他任务、原始会话文件或凭据，也不要上传或公开分享。如果新 MCP 工具仅未热加载且无旧冲突，就由你在当前对话整理方法，按固定版本安装说明调用它的本地编译器；不要另外启动模型或读取旧会话来恢复内容。

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
