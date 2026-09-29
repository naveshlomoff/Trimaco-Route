// Data access used by the screens. The live app talks to Supabase
// (supabaseStore.ts); local development can run on an in-memory copy
// (memoryStore.ts) to try the screens without logging in.

import type { DayRow, Place, PlaceKind, Profile, Region, TaskRow, Worker } from './types';

export interface NewPlace {
  name: string;
  region: Region;
  kind: PlaceKind;
  aliases?: string[];
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export type NewTask = Omit<TaskRow, 'id' | 'date'>;

export interface SaveDayInput {
  date: string;
  rawText: string;
  intro: string | null;
  vehicleNotes: string[];
  notes: string[];
  source: DayRow['source'];
  messageSentAt: string | null;
  tasks: NewTask[];
}

export interface DaySummary {
  date: string;
  saved_at: string;
  source: DayRow['source'];
  version: number;
}

export interface Store {
  getProfile(): Promise<Profile | null>;
  /** No passwords: this device signs in with the person's name and is in right away. */
  enter(name: string): Promise<string | null>;
  onAuthChange(cb: () => void): () => void;
  listProfiles(): Promise<Profile[]>;
  updateProfile(id: string, patch: Partial<Pick<Profile, 'role' | 'display_name'>>): Promise<void>;

  loadWorkers(): Promise<Worker[]>;
  loadPlaces(): Promise<Place[]>;
  createPlace(p: NewPlace): Promise<Place>;
  updatePlace(id: string, patch: Partial<Omit<Place, 'id'>>): Promise<void>;
  deletePlace(id: string): Promise<void>;
  addPlaceAlias(id: string, alias: string): Promise<void>;
  mergePlaces(sourceId: string, targetId: string): Promise<void>;
  /** Points every saved task written as `text` (and still without a place) at `placeId`. */
  resolveLocationText(text: string, placeId: string): Promise<void>;

  saveDay(input: SaveDayInput): Promise<void>;
  deleteDay(date: string): Promise<void>;
  listDays(limit: number): Promise<DaySummary[]>;
  getDay(date: string): Promise<{ day: DayRow; tasks: TaskRow[] } | null>;
  existingDates(dates: string[]): Promise<Set<string>>;
  tasksBetween(from: string, to: string): Promise<TaskRow[]>;
  unresolvedTasks(): Promise<TaskRow[]>;
}

let current: Store | null = null;

export function setStore(s: Store): void {
  current = s;
}

export function store(): Store {
  if (!current) throw new Error('store not initialised');
  return current;
}
