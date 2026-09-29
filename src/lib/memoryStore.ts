// In-memory Store for local development (npm run dev, then open with ?demo,
// or ?demo=new to start on the welcome screen). Mirrors the database
// functions in supabase/schema.sql closely enough to click through every
// screen without a server.

import type { Store } from './store';
import type { AdviceDecision, DayRow, Place, Profile, TaskRow, Worker } from './types';
import { normalizeKey } from './text';

export interface MemorySeed {
  workers: Worker[];
  places: Omit<Place, 'id'>[];
  /** Start on the welcome screen instead of signed in as an admin. */
  startSignedOut?: boolean;
}

let counter = 0;
const newId = () => `mem-${++counter}`;

function withAlias(place: Place, alias: string): Place {
  const a = alias.trim();
  if (!a || a === place.name || place.aliases.includes(a)) return place;
  return { ...place, aliases: [...place.aliases, a] };
}

export function createMemoryStore(seed: MemorySeed): Store {
  const listeners = new Set<() => void>();
  const now = new Date().toISOString();
  let profiles: Profile[] = [
    { id: 'c0ffee01-demo', username: 'u-c0ffee01', display_name: 'מכשיר של דוגמה', role: 'planner', created_at: now },
  ];
  let me: string | null = null;
  if (!seed.startSignedOut) {
    profiles.unshift({ id: 'ad3141aa-demo', username: 'u-ad3141aa', display_name: 'מנהל דמו', role: 'admin', created_at: now });
    me = 'ad3141aa-demo';
  }
  let places: Place[] = seed.places.map((p) => ({ ...p, id: newId() }));
  const days = new Map<string, DayRow>();
  let tasks: TaskRow[] = [];
  let advice: AdviceDecision[] = [];
  const notify = () => listeners.forEach((l) => l());

  return {
    async getProfile() {
      return profiles.find((p) => p.id === me) ?? null;
    },
    async enter(name) {
      const id = `${Math.random().toString(16).slice(2, 10)}-demo`;
      const role = profiles.some((p) => p.role === 'admin') ? 'planner' : 'admin'; // first device is the admin
      profiles.unshift({ id, username: `u-${id.slice(0, 8)}`, display_name: name.trim(), role, created_at: now });
      me = id;
      notify();
      return null;
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async listProfiles() {
      return profiles;
    },
    async updateProfile(id, patch) {
      profiles = profiles.map((p) => (p.id === id ? { ...p, ...patch } : p));
    },
    async loadWorkers() {
      return [...seed.workers].sort((a, b) => a.sort_order - b.sort_order);
    },
    async loadPlaces() {
      return [...places].sort((a, b) => a.name.localeCompare(b.name, 'he'));
    },
    async createPlace(p) {
      if (places.some((x) => x.name === p.name.trim())) throw new Error('כבר קיים מקום בשם הזה');
      const place: Place = {
        id: newId(),
        name: p.name.trim(),
        aliases: p.aliases ?? [],
        region: p.region,
        kind: p.kind,
        city: p.city ?? null,
        address: p.address ?? null,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        notes: null,
      };
      places.push(place);
      return place;
    },
    async updatePlace(id, patch) {
      places = places.map((p) => (p.id === id ? { ...p, ...patch } : p));
    },
    async deletePlace(id) {
      if (tasks.some((t) => t.place_id === id)) throw new Error('יש משימות שמשויכות למקום הזה');
      places = places.filter((p) => p.id !== id);
    },
    async addPlaceAlias(id, alias) {
      places = places.map((p) => (p.id === id ? withAlias(p, alias) : p));
    },
    async mergePlaces(sourceId, targetId) {
      const src = places.find((p) => p.id === sourceId);
      if (!src || sourceId === targetId) return;
      tasks = tasks.map((t) => (t.place_id === sourceId ? { ...t, place_id: targetId } : t));
      places = places
        .filter((p) => p.id !== sourceId)
        .map((p) => (p.id === targetId ? [src.name, ...src.aliases].reduce(withAlias, p) : p));
    },
    async resolveLocationText(text, placeId) {
      tasks = tasks.map((t) => (!t.place_id && t.location_text === text ? { ...t, place_id: placeId } : t));
      places = places.map((p) => (p.id === placeId && normalizeKey(text) !== normalizeKey(p.name) ? withAlias(p, text) : p));
    },
    async saveDay(input) {
      const prev = days.get(input.date);
      days.set(input.date, {
        date: input.date,
        raw_text: input.rawText,
        intro: input.intro,
        vehicle_notes: input.vehicleNotes,
        notes: input.notes,
        source: input.source,
        message_sent_at: input.messageSentAt,
        saved_by: me,
        saved_at: new Date().toISOString(),
        version: (prev?.version ?? 0) + 1,
      });
      tasks = tasks.filter((t) => t.date !== input.date);
      tasks.push(...input.tasks.map((t) => ({ ...t, id: newId(), date: input.date })));
    },
    async deleteDay(date) {
      days.delete(date);
      tasks = tasks.filter((t) => t.date !== date);
    },
    async listDays(limit) {
      return [...days.values()]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(({ date, saved_at, source, version }) => ({ date, saved_at, source, version }));
    },
    async getDay(date) {
      const day = days.get(date);
      if (!day) return null;
      return { day, tasks: tasks.filter((t) => t.date === date).sort((a, b) => a.seq - b.seq) };
    },
    async existingDates(dates) {
      return new Set(dates.filter((d) => days.has(d)));
    },
    async tasksBetween(from, to) {
      return tasks.filter((t) => t.date >= from && t.date <= to);
    },
    async unresolvedTasks() {
      return tasks.filter((t) => !t.place_id && t.location_text);
    },
    async recordAdvice(rows, opts) {
      const key = (r: AdviceDecision) => [r.date, r.place_id, r.from_worker, r.to_worker].join('|');
      for (const r of rows) {
        const exists = advice.some((a) => key(a) === key(r));
        if (exists && opts?.keepExisting) continue;
        advice = [
          ...advice.filter((a) => key(a) !== key(r)),
          { ...r, decided_by: me, decided_at: new Date().toISOString() },
        ];
      }
    },
    async listAdvice(from, to) {
      return advice
        .filter((a) => a.date >= from && a.date <= to)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.decided_at ?? '').localeCompare(a.decided_at ?? ''));
    },
  };
}
