import type { ReactElement } from 'react';

export function ComboMark({ className }: { className?: string }): ReactElement {
  const cls = className ? `cb-brand-mark ${className}` : 'cb-brand-mark';
  return (
    <span className={cls} aria-hidden="true">
      <span className="cb-brand-mark__letter">C</span>
      <span className="cb-brand-mark__dot" />
    </span>
  );
}

export function ComboWordmark({ className }: { className?: string }): ReactElement {
  const cls = className ? `cb-brand-wordmark ${className}` : 'cb-brand-wordmark';
  return (
    <span className={cls} aria-hidden="true">
      <span>Com</span>
      <span className="cb-brand-wordmark__accent">bo</span>
      <span className="cb-brand-wordmark__dot">.</span>
    </span>
  );
}
