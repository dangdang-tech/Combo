import { useEffect, useState, type ReactElement } from 'react';

export function formatElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder} 秒`;
}

export function elapsedSeconds(startedAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - startedAt) / 1_000));
}

export function RunningTimer({
  active,
  startedAt,
  className,
  prefix = '运行中',
}: {
  active: boolean;
  /** 同一轮共享的开始时间；生成卡与悬浮窗切换时计时不中断。 */
  startedAt?: number;
  className?: string;
  prefix?: string;
}): ReactElement | null {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const effectiveStartedAt = startedAt ?? Date.now();
    setElapsed(elapsedSeconds(effectiveStartedAt));
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      setElapsed(elapsedSeconds(effectiveStartedAt));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  if (!active) return null;
  return (
    <span className={className} aria-label={`${prefix}，已运行 ${formatElapsed(elapsed)}`}>
      {prefix} · {formatElapsed(elapsed)}
    </span>
  );
}
