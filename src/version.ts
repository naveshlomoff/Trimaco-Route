import { useEffect, useState } from 'react';

/** Commit the running build came from (set by the deploy workflow), "dev" locally. */
export const BUILD_ID = (import.meta.env.VITE_BUILD_SHA as string | undefined)?.slice(0, 7) ?? 'dev';

const CHECK_EVERY_MS = 10 * 60 * 1000;

function currentBundle(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]');
  return s?.getAttribute('src')?.match(/assets\/index-[\w-]+\.js/)?.[0] ?? null;
}

async function liveBundle(): Promise<string | null> {
  const res = await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.text()).match(/assets\/index-[\w-]+\.js/)?.[0] ?? null;
}

/**
 * True once a newer version is live than the one running. A phone keeps
 * an open app for days, so without this Adi could stay on an old version.
 */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return; // local development
    const check = () => {
      liveBundle()
        .then((live) => {
          if (live && live !== mine) setAvailable(true);
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return available;
}
