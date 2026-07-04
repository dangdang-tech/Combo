// 任务详情：GET /tasks/:id + SSE GET /tasks/:id/events 实时进度。
//   - state_snapshot 全量 progress（subtasks 逐条点亮）+ progress 增量帧；
//   - item-appended 逐个显示新提取的能力项（边提取边显示）；
//   - done 帧终态 → 重拉任务定格视图；失败显示 lastError 人话 + 重试。
// 提取完成后引导跳能力页（带 taskId 过滤）。
import { useEffect, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CapabilityView, TaskView } from '@cb/shared';
import { getTask, retryTask, taskEventsUrl, useTaskEvents } from '../../api/index.js';
import {
  ErrorState,
  ProgressBar,
  Skeleton,
  SlowHint,
  SubtaskChecklist,
} from '../../components/index.js';
import {
  formatTime,
  taskStatusLabel,
  taskStatusVariant,
  taskTitle,
  uploadProgressLabel,
} from './taskPresent.js';

export function TaskDetailPage(): ReactElement {
  const { taskId = '' } = useParams();
  const qc = useQueryClient();

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => getTask(taskId),
    enabled: taskId.length > 0,
    // 上传阶段没有 SSE 帧（分片计数在任务视图里），跑着的任务轮询兜底刷新；终态停。
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 3000 : false),
  });
  const task = taskQuery.data;

  // 只有在跑的任务才建流；SSE 定终态后重拉任务（capabilityCount / lastError 定格）。
  const sse = useTaskEvents(task ? taskEventsUrl(task.id) : null, {
    enabled: task?.status === 'running',
  });
  const sseTerminal = sse.status === 'done' || (sse.status === 'error' && !!sse.done);
  useEffect(() => {
    if (sseTerminal) void qc.invalidateQueries({ queryKey: ['task', taskId] });
  }, [sseTerminal, qc, taskId]);

  const retryMutation = useMutation({
    mutationFn: () => retryTask(taskId),
    onSuccess: (view) => {
      qc.setQueryData(['task', taskId], view); // 立即回 running，重新建流。
    },
  });

  if (taskQuery.isPending) return <Skeleton rows={5} label="正在加载任务" />;
  if (taskQuery.isError) {
    return <ErrorState error={taskQuery.error} onRetry={() => void taskQuery.refetch()} />;
  }
  if (!task) return <ErrorState error={undefined} />;

  return (
    <section className="cb-page" aria-labelledby="cb-task-detail-title">
      <p className="cb-page__back">
        <Link to="/tasks">← 返回任务列表</Link>
      </p>
      <div className="cb-page__head">
        <h2 className="cb-page__title" id="cb-task-detail-title">
          {taskTitle(task)}
        </h2>
        <p className="cb-page__lead">
          创建于 {formatTime(task.createdAt)} ·{' '}
          <span className={`cb-status-badge is-${taskStatusVariant(task)}`}>
            {taskStatusLabel(task)}
          </span>
        </p>
      </div>

      <UploadCard task={task} />
      {task.status === 'running' && task.currentStep === 'extract' && <ExtractCard sse={sse} />}
      {sse.items.length > 0 && <NewItemsCard items={sse.items} />}
      <OutcomeCard
        task={task}
        onRetry={() => retryMutation.mutate()}
        retryPending={retryMutation.isPending}
        retryError={retryMutation.isError ? retryMutation.error : null}
      />
    </section>
  );
}

/** 上传阶段卡：分片进度 + 配对提示。 */
function UploadCard({ task }: { task: TaskView }): ReactElement {
  const waiting = task.currentStep === 'upload' && task.status === 'running';
  return (
    <div className="cb-card">
      <h3 className="cb-card__title">上传</h3>
      <p className="cb-card__line">{uploadProgressLabel(task)}</p>
      {waiting && (
        <p className="cb-card__hint">
          在本机运行建任务时给出的连接命令即可开始上传（配对码有效期至{' '}
          {formatTime(task.upload.pairingExpiresAt)}
          ）；配对码过期或丢失时，回任务列表重新建一个任务。
        </p>
      )}
    </div>
  );
}

/** 提取阶段卡：SSE 实时进度（进度条 + 子任务点亮 + 慢提示 + 重连安抚）。 */
function ExtractCard({ sse }: { sse: ReturnType<typeof useTaskEvents> }): ReactElement {
  return (
    <div className="cb-card" data-sse-status={sse.status}>
      <h3 className="cb-card__title">提取</h3>
      {sse.status === 'reconnecting' && (
        <p className="cb-card__reconnect" role="status" aria-live="polite">
          连接断了，正在自动重连…（进度不会丢）
        </p>
      )}
      {sse.progress ? (
        <>
          <ProgressBar progress={sse.progress} />
          {sse.progress.subtasks.length > 0 && (
            <SubtaskChecklist subtasks={sse.progress.subtasks} />
          )}
        </>
      ) : (
        <Skeleton rows={2} label="正在连接进度流" />
      )}
      <SlowHint slowHint={sse.slowHint} />
    </div>
  );
}

/** 边提取边显示：item-appended 逐个推出的新能力项。 */
function NewItemsCard({ items }: { items: CapabilityView[] }): ReactElement {
  return (
    <div className="cb-card">
      <h3 className="cb-card__title">本次提取出的能力项</h3>
      <ul className="cb-newitems">
        {items.map((c) => (
          <li key={c.id} className="cb-newitems__item">
            <span className="cb-newitems__name">{c.name}</span>
            <span className="cb-newitems__kind">{c.kind}</span>
            <p className="cb-newitems__summary">{c.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 终态区：失败给人话 + 重试；成功引导跳能力页。 */
function OutcomeCard({
  task,
  onRetry,
  retryPending,
  retryError,
}: {
  task: TaskView;
  onRetry: () => void;
  retryPending: boolean;
  retryError: unknown;
}): ReactElement | null {
  if (task.status === 'failed') {
    return (
      <div className="cb-card cb-card--failed">
        <h3 className="cb-card__title">这次没成功</h3>
        {task.lastError ? (
          <p className="cb-card__line cb-task-error">{task.lastError.userMessage}</p>
        ) : (
          <p className="cb-card__line cb-task-error">任务失败了，可以重试一次。</p>
        )}
        {task.retryCount > 0 && <p className="cb-card__hint">已重试 {task.retryCount} 次。</p>}
        <button type="button" className="cb-primary-btn" onClick={onRetry} disabled={retryPending}>
          {retryPending ? '正在重试…' : '重试'}
        </button>
        {retryError != null && <ErrorState error={retryError} onRetry={onRetry} />}
      </div>
    );
  }
  if (task.status === 'succeeded') {
    return (
      <div className="cb-card cb-card--succeeded">
        <h3 className="cb-card__title">提取完成</h3>
        <p className="cb-card__line">
          共提取出 {task.capabilityCount} 个能力项，去能力页查看、发布或试用。
        </p>
        <Link
          className="cb-primary-btn cb-primary-btn--link"
          to={`/capabilities?taskId=${task.id}`}
        >
          去能力页
        </Link>
      </div>
    );
  }
  return null;
}
