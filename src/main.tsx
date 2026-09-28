import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setStore, type Store } from './lib/store';
import { createSupabaseStore } from './lib/supabaseStore';
import './styles.css';

async function pickStore(): Promise<{ store: Store; demo: boolean }> {
  // Local development only: `npm run dev`, then open the page with ?demo
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
    const { createDemoStore } = await import('./dev/demo');
    return { store: createDemoStore(), demo: true };
  }
  return { store: createSupabaseStore(), demo: false };
}

void pickStore().then(({ store, demo }) => {
  setStore(store);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App demo={demo} />
    </StrictMode>,
  );
});
