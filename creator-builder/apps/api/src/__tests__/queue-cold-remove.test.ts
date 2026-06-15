// Codex P1-r4 · 取消清理跨【全部 job 类型】触发（冷启动/重启后进程未预先实例化队列也能清到）。
//   背景旧 bug：remove(jobId) 只扫 queues.values()（进程内已实例化的队列）。冷启动/重启后取消时，
//   本进程还没 enqueue 过该业务 job 所属类型的队列 → queues map 为空/缺该类型 → 扫不到 → 清不掉
//   重启前 BullMQ 里已有的 attempt 触发 → worker 仍会被重投。
//   修复：remove 遍历 ACTIVE_JOB_TYPES，对每类 queueFor(env,type) 惰性补建后按 data.jobId 扫全队列各态移除。
//   本测用【每个队列名一条独立假 Queue】的工厂，模拟「重启前 BullMQ 里已有触发、但进程冷 map 未实例化」。
import { describe, it, expect, vi } from 'vitest';

/** 一条假 BullMQ job（按 data.jobId 可被 remove）。 */
interface FakeBullJob {
  id: string;
  name: string;
  data: { jobId: string; fenceToken: number };
  removed: boolean;
  remove: () => Promise<void>;
}

/** 每个队列名一条独立假 Queue（区分 job 类型）。getJobs 返回未 remove 的全部 job。 */
class FakeBullQueue {
  readonly jobs = new Map<string, FakeBullJob>();
  constructor(readonly name: string) {}

  /** 测试夹具：直接往这条队列种一条「重启前 BullMQ 里已有」的触发（不经 createBullQueuePort）。 */
  seed(jobId: string, fenceToken: number): void {
    const bullId = `${jobId}:${fenceToken}`;
    const job: FakeBullJob = {
      id: bullId,
      name: this.name,
      data: { jobId, fenceToken },
      removed: false,
      remove: async () => {
        job.removed = true;
        this.jobs.delete(bullId);
      },
    };
    this.jobs.set(bullId, job);
  }

  async getJobs(_states: string[], _start?: number, _end?: number): Promise<FakeBullJob[]> {
    return [...this.jobs.values()].filter((j) => !j.removed);
  }

  async close(): Promise<void> {
    /* noop */
  }
}

// —— 每个队列名一条独立实例（new Queue('cb:<type>') 拿到对应那条）。记录 newQueueCalls 证明冷 map 惰性补建。——
const queuesByName = new Map<string, FakeBullQueue>();
const newQueueCalls: string[] = [];
function getOrMakeFake(name: string): FakeBullQueue {
  let q = queuesByName.get(name);
  if (!q) {
    q = new FakeBullQueue(name);
    queuesByName.set(name, q);
  }
  return q;
}
vi.mock('bullmq', () => ({
  Queue: vi.fn((name: string) => {
    newQueueCalls.push(name);
    return getOrMakeFake(name);
  }),
}));

const { createBullQueuePort, closeQueues } = await import('../infra/queue.js');
const env = { REDIS_QUEUE_URL: 'redis://localhost:6379/0' } as never;

/** 每个 it 前彻底冷起：清 queue.ts 内部 queues map + 底层假队列工厂 + new Queue 调用记录。 */
async function coldStart(): Promise<void> {
  await closeQueues(); // 清 queue.ts 内部 queues map（模拟进程重启后的冷 map）
  queuesByName.clear();
  newQueueCalls.length = 0;
}

describe('remove 跨全部 job 类型清理触发（Codex P1-r4：冷 map 也清得到）', () => {
  it('冷 map（进程从未实例化该类型队列）→ remove 仍能清到重启前 BullMQ 里已有的 attempt 触发', async () => {
    await coldStart();

    // 模拟「重启前 BullMQ 里已有触发」：直接在底层假队列种 job-cold 的两个 attempt 触发（不经 enqueue）。
    //   注意：这是【冷 map】——当前进程的 queue.ts queues map 还没实例化过任何队列（seed 不走 queueFor）。
    const extractQ = getOrMakeFake('cb:extract');
    extractQ.seed('job-cold', 1);
    extractQ.seed('job-cold', 2);
    // 另一类型里不相干的 job，验证不误删。
    const importQ = getOrMakeFake('cb:import');
    importQ.seed('other', 1);

    const port = createBullQueuePort(env);
    // 取消：进程内 queues map 此前没 enqueue 过 → 旧实现只扫 queues.values()（空）会清不到。
    await port.remove('job-cold' as never);

    // 关键：remove 遍历 ACTIVE_JOB_TYPES 惰性补建了各类型队列（含 extract）→ 扫到并清掉两个 attempt 触发。
    expect(extractQ.jobs.has('job-cold:1')).toBe(false);
    expect(extractQ.jobs.has('job-cold:2')).toBe(false);
    // 不相干 job 不动。
    expect(importQ.jobs.has('other:1')).toBe(true);
    // 证明确实按【全部活动类型】惰性补建了队列（而非只扫进程内已建的；旧实现这里一条都不会 new）。
    expect(newQueueCalls).toEqual(
      expect.arrayContaining(['cb:import', 'cb:extract', 'cb:structure', 'cb:publish_batch']),
    );
  });

  it('业务 job 属某一类型，其它类型空队列被扫但无害（不抛、不误删）', async () => {
    await coldStart();

    const structureQ = getOrMakeFake('cb:structure');
    structureQ.seed('job-s', 7);

    const port = createBullQueuePort(env);
    await port.remove('job-s' as never);

    expect(structureQ.jobs.has('job-s:7')).toBe(false);
    // 其余三类型队列被惰性补建、扫了空队列、无异常。
    expect(newQueueCalls).toEqual(
      expect.arrayContaining(['cb:import', 'cb:extract', 'cb:structure', 'cb:publish_batch']),
    );
  });
});
