// 建任务成功后的配对引导卡：配对码明文只在这里出现一次（库里只存哈希），提示用户复制；
// 附本机助手一条命令（GET /connect/script?code=<配对码> 下发脚本，`| sh` 直跑）。
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { CreateTaskResult } from '@cb/shared';
import { connectCommand } from '../../api/index.js';
import { CopyButton } from '../../components/CopyButton.js';
import { formatTime } from './taskPresent.js';

export interface PairingCardProps {
  created: CreateTaskResult;
  onDismiss: () => void;
}

export function PairingCard({ created, onDismiss }: PairingCardProps): ReactElement {
  const command = connectCommand(created.pairingCode);
  return (
    <section className="cb-pairing" aria-labelledby="cb-pairing-title">
      <div className="cb-pairing__header">
        <div>
          <p className="cb-pairing__eyebrow">任务已创建</p>
          <h3 className="cb-pairing__title" id="cb-pairing-title">
            复制命令，在终端运行
          </h3>
          <p className="cb-pairing__summary">助手会连接这个任务，上传进度会在下方队列实时更新。</p>
        </div>
        <Link className="cb-pairing__detail" to={`/tasks/${created.task.id}`}>
          查看进度
        </Link>
      </div>

      <div className="cb-pairing__code-row">
        <span className="cb-pairing__label">配对码</span>
        <code className="cb-pairing__code">{created.pairingCode}</code>
        <CopyButton text={created.pairingCode} label="复制" />
        <span className="cb-pairing__note">
          只显示一次，有效期至 {formatTime(created.task.upload.pairingExpiresAt)}
        </span>
      </div>

      <div className="cb-cmdbox" aria-label="本机助手连接命令">
        <div className="cb-cmdbox__head">
          <span className="cb-pairing__label">终端命令</span>
          <span className="cb-cmdbox__hint">复制整行后粘贴运行</span>
        </div>
        <div className="cb-cmdbox__command">
          <code className="cb-cmdbox__command-text">{command}</code>
          <CopyButton text={command} label="复制命令" className="cb-cmdbox__copy" />
        </div>
      </div>

      <div className="cb-pairing__actions">
        <p className="cb-pairing__phase">命令中断后重跑同一条即可续传。</p>
        <button type="button" className="cb-pairing__dismiss" onClick={onDismiss}>
          我已复制，关闭
        </button>
      </div>

      <details className="cb-pairing__details">
        <summary>这条命令会读取什么？</summary>
        <p>
          它会读取本机的对话历史（~/.claude 与
          ~/.codex）并上传到云端；云端会在提取前抹掉手机号、密钥等隐私信息。
        </p>
      </details>
    </section>
  );
}
