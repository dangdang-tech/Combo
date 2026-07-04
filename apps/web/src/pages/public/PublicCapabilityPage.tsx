// 公开能力页 /a/:slug（对外只读，裸壳 PublicLayout，无创作者外壳）。
// 只拉 runtime 公开视图：无 instructions / manifestHash，不发 /me，不暴露创作者后台数据。
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { API_PREFIX, sanitizeErrorEnvelope, type PublicCapabilityView } from '@cb/shared';
import { ApiError } from '../../api/index.js';
import { ErrorState, Skeleton } from '../../components/index.js';

function publicCapabilityPath(slug: string): string {
  return `/runtime/capabilities/${encodeURIComponent(slug)}`;
}

async function fetchPublicCapability(slug: string): Promise<PublicCapabilityView> {
  const res = await fetch(`${API_PREFIX}${publicCapabilityPath(slug)}`, {
    method: 'GET',
    credentials: 'include',
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiError(sanitizeErrorEnvelope(body));
  return body as PublicCapabilityView;
}

function toPlainPublicText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .trim();
}

export function PublicCapabilityPage(): ReactElement {
  const { slug = '' } = useParams<{ slug?: string }>();
  const query = useQuery({
    queryKey: ['public-capability', slug],
    queryFn: () => fetchPublicCapability(slug),
    enabled: slug.length > 0,
  });

  if (query.isLoading) {
    return (
      <section className="cb-page cb-public" aria-busy="true">
        <Skeleton rows={5} label="公开能力页加载中" />
      </section>
    );
  }

  if (query.isError || !query.data) {
    return (
      <section className="cb-page cb-public">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </section>
    );
  }

  const capability = query.data;

  return (
    <section
      className="cb-page cb-public cb-public-capability"
      aria-labelledby="cb-public-capability-title"
    >
      <header className="cb-public-capability__hero">
        <p className="cb-public-capability__eyebrow">公开能力</p>
        <h1 className="cb-public-capability__title" id="cb-public-capability-title">
          {capability.name}
        </h1>
        <p className="cb-public-capability__tagline">{capability.tagline}</p>
        <p className="cb-public-capability__description">
          {toPlainPublicText(capability.description)}
        </p>
        <div className="cb-public-capability__actions">
          <a className="cb-public__action" href={`/try/c/${encodeURIComponent(capability.slug)}`}>
            开始使用
          </a>
          <a className="cb-public__action cb-public__action--ghost" href="/try/market">
            返回市集
          </a>
        </div>
      </header>

      <div className="cb-public-capability__grid">
        <section className="cb-public-capability__panel" aria-labelledby="cb-public-inputs-title">
          <h2 className="cb-public-capability__section-title" id="cb-public-inputs-title">
            需要你提供
          </h2>
          <ul className="cb-public-capability__field-list">
            {capability.inputs.fields.map((field) => (
              <li className="cb-public-capability__field" key={field.key}>
                <span>{field.label}</span>
                <small>
                  {field.required ? '必填' : '可选'} · {field.type}
                </small>
              </li>
            ))}
          </ul>
        </section>

        <section className="cb-public-capability__panel" aria-labelledby="cb-public-prompts-title">
          <h2 className="cb-public-capability__section-title" id="cb-public-prompts-title">
            可以这样开始
          </h2>
          <ul className="cb-public-capability__prompt-list">
            {capability.starterPrompts.map((prompt) => (
              <li className="cb-public-capability__prompt" key={prompt}>
                {prompt}
              </li>
            ))}
          </ul>
        </section>

        <section
          className="cb-public-capability__panel cb-public-capability__panel--wide"
          aria-labelledby="cb-public-boundaries-title"
        >
          <h2 className="cb-public-capability__section-title" id="cb-public-boundaries-title">
            使用边界
          </h2>
          <ul className="cb-public-capability__boundary-list">
            {capability.boundaries.redLines.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
