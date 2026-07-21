import type { ReactElement } from 'react';

export function ComboMark({ className }: { className?: string }): ReactElement {
  const cls = className ? `rt-combo-mark ${className}` : 'rt-combo-mark';
  return (
    <span className={cls} aria-hidden="true">
      <span className="rt-combo-mark__letter">C</span>
      <span className="rt-combo-mark__dot" />
    </span>
  );
}

export function ComboWordmark({ className }: { className?: string }): ReactElement {
  const cls = className ? `rt-combo-wordmark ${className}` : 'rt-combo-wordmark';
  return (
    <span className={cls} aria-hidden="true">
      <span>Com</span>
      <span className="rt-combo-wordmark__accent">bo</span>
      <span className="rt-combo-wordmark__dot">.</span>
    </span>
  );
}
