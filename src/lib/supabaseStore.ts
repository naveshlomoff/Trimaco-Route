import { createClient } from '@supabase/supabase-js';
import { LOGIN_DOMAIN, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import type { Store } from './store';
import type { DayRow, Place, Profile, TaskRow, Worker } from './types';

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}

function check<T>(res: Result<T>): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const PAGE = 1000; // PostgREST returns at most 1000 rows per request

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<Result<T[]>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(await page(from, from + PAGE - 1)) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export function createSupabaseStore(): Store {
  const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  return {
    async getProfile() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      const res = await sb.from('profiles').select('id, username, display_name, role').eq('id', user.id).maybeSingle();
      const profile = check(res) as Profile | null;
      const username = user.email?.split('@')[0] ?? '';
      return profile ?? { id: user.id, username, display_name: username, role: 'planner' };
    },

    async signIn(username, password) {
      const u = username.trim().toLowerCase();
      const email = u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`;
      const { error } = await sb.auth.signInWithPassword({ email, password });
      return error ? 'שם משתמש או סיסמה שגויים' : null;
    },

    async signOut() {
      await sb.auth.signOut();
    },

    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') cb();
      });
      return () => data.subscription.unsubscribe();
    },

    async loadWorkers() {
      return check(await sb.from('workers').select('*').eq('active', true).order('sort_order')) as Worker[];
    },

    async loadPlaces() {
      return fetchAll<Place>((from, to) => sb.from('places').select('*').order('name').range(from, to));
    },

    async createPlace(p) {
      const row = {
        name: p.name.trim(),
        region: p.region,
        kind: p.kind,
        aliases: p.aliases ?? [],
        city: p.city ?? null,
        address: p.address ?? null,
      };
      return check(await sb.from('places').insert(row).select('*').single()) as Place;
    },

    async updatePlace(id, patch) {
      check(await sb.from('places').update(patch).eq('id', id));
    },

    async deletePlace(id) {
      check(await sb.from('places').delete().eq('id', id));
    },

    async addPlaceAlias(id, alias) {
      check(await sb.rpc('add_place_alias', { p_place: id, p_alias: alias }));
    },

    async mergePlaces(sourceId, targetId) {
      check(await sb.rpc('merge_places', { p_source: sourceId, p_target: targetId }));
    },

    async resolveLocationText(text, placeId) {
      check(await sb.rpc('resolve_location_text', { p_text: text, p_place: placeId }));
    },

    async saveDay(input) {
      const day = {
        raw_text: input.rawText,
        intro: input.intro,
        vehicle_notes: input.vehicleNotes,
        notes: input.notes,
        source: input.source,
        message_sent_at: input.messageSentAt,
      };
      check(await sb.rpc('save_day', { p_date: input.date, p_day: day, p_tasks: input.tasks }));
    },

    async deleteDay(date) {
      check(await sb.from('days').delete().eq('date', date));
    },

    async listDays(limit) {
      return check(
        await sb.from('days').select('date, saved_at, source, version').order('date', { ascending: false }).limit(limit),
      ) as { date: string; saved_at: string; source: DayRow['source']; version: number }[];
    },

    async getDay(date) {
      const day = check(await sb.from('days').select('*').eq('date', date).maybeSingle()) as DayRow | null;
      if (!day) return null;
      const tasks = check(await sb.from('tasks').select('*').eq('date', date).order('seq')) as TaskRow[];
      return { day, tasks };
    },

    async existingDates(dates) {
      const found = new Set<string>();
      for (let i = 0; i < dates.length; i += 100) {
        const chunk = dates.slice(i, i + 100);
        const rows = check(await sb.from('days').select('date').in('date', chunk)) as { date: string }[];
        rows.forEach((r) => found.add(r.date));
      }
      return found;
    },

    async tasksBetween(from, to) {
      return fetchAll<TaskRow>((a, b) =>
        sb.from('tasks').select('*').gte('date', from).lte('date', to).order('date').order('id').range(a, b),
      );
    },

    async unresolvedTasks() {
      return fetchAll<TaskRow>((a, b) =>
        sb
          .from('tasks')
          .select('*')
          .is('place_id', null)
          .not('location_text', 'is', null)
          .order('date', { ascending: false })
          .order('id')
          .range(a, b),
      );
    },
  };
}
