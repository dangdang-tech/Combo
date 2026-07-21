import { useQuery } from '@tanstack/react-query';
import { MeViewSchema, envelopeSchema, type MeView } from '@cb/shared';
import { createContext, useContext, type ReactNode } from 'react';

const MeEnvelopeSchema = envelopeSchema(MeViewSchema);
const RuntimeMeContext = createContext<MeView | null>(null);

export function useRuntimeMe(): MeView | null {
  return useContext(RuntimeMeContext);
}

async function fetchMe(
  signal?: AbortSignal,
): Promise<{ status: 'authed'; me: MeView } | { status: 'anon' } | { status: 'error' }> {
  let res: Response;
  try {
    res = await fetch('/api/v1/me', {
      method: 'GET',
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    return { status: 'error' };
  }
  if (res.status === 401) return { status: 'anon' };
  if (!res.ok) return { status: 'error' };
  try {
    const body = (await res.json()) as unknown;
    return { status: 'authed', me: MeEnvelopeSchema.parse(body).data };
  } catch {
    return { status: 'error' };
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ['runtime-web-me'],
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const me = q.data?.status === 'authed' ? q.data.me : null;

  return <RuntimeMeContext.Provider value={me}>{children}</RuntimeMeContext.Provider>;
}
