import { createContext, useContext } from 'react';
import type { Place, Profile, Worker } from './lib/types';

export interface AppData {
  profile: Profile;
  workers: Worker[];
  places: Place[];
  reloadPlaces: () => Promise<void>;
  demo: boolean;
}

export const AppContext = createContext<AppData | null>(null);

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside the app');
  return ctx;
}

export function navigate(path: string): void {
  window.location.hash = path;
  window.scrollTo(0, 0);
}
