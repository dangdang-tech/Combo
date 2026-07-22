import { RunningTimer } from './RunningTimer.js';

/**
 * Honest first-generation state: a page-shaped skeleton and one observable fact.
 * It deliberately avoids invented progress percentages or pseudo workflow steps.
 */
export function GeneratingPageSkeleton({ startedAt }: { startedAt?: number }) {
  return (
    <section className="rt-generating-page" aria-label="正在生成页面">
      <header className="rt-generating-page__status">
        <span className="rt-generating-page__state" role="status" aria-live="polite">
          <span className="rt-generating-page__pulse" aria-hidden="true" />
          <strong>正在生成页面</strong>
        </span>
        <RunningTimer active startedAt={startedAt} className="rt-generating-page__timer" />
      </header>
      <div className="rt-generating-page__sheet" aria-hidden="true">
        <div className="rt-generating-page__topline">
          <span />
          <i />
        </div>
        <div className="rt-generating-page__hero">
          <b />
          <strong />
          <span />
        </div>
        <div className="rt-generating-page__cards">
          <article>
            <i />
            <b />
            <span />
          </article>
          <article>
            <i />
            <b />
            <span />
          </article>
        </div>
      </div>
    </section>
  );
}
