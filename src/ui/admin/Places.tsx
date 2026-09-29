import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { formatDayShort } from '../../lib/dates';
import type { Resolution, UnknownGroup } from '../../lib/draft';
import { KIND_LABELS, KIND_ORDER, REGION_LABELS, REGION_ORDER } from '../../lib/labels';
import { buildPlaceIndex, lookupPlace } from '../../lib/parser';
import { store } from '../../lib/store';
import { normalizeKey } from '../../lib/text';
import type { Place, PlaceKind, Region, TaskRow } from '../../lib/types';
import { PlaceResolver, PlaceSearch } from '../components';

interface Unresolved extends UnknownGroup {
  lastDate: string;
}

export function Places() {
  const { places, reloadPlaces } = useApp();
  const [unresolved, setUnresolved] = useState<Unresolved[] | null>(null);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<Region | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = useMemo(() => buildPlaceIndex(places), [places]);

  const loadUnresolved = useCallback(async () => {
    const rows: TaskRow[] = await store().unresolvedTasks();
    const groups = new Map<string, Unresolved>();
    for (const t of rows) {
      if (!t.location_text) continue;
      const key = normalizeKey(t.location_text);
      const g = groups.get(key) ?? { key, texts: [], count: 0, candidates: [], lastDate: t.date };
      if (!g.texts.includes(t.location_text)) g.texts.push(t.location_text);
      g.count++;
      if (t.date > g.lastDate) g.lastDate = t.date;
      groups.set(key, g);
    }
    setUnresolved([...groups.values()].sort((a, b) => b.count - a.count));
  }, []);

  useEffect(() => {
    void loadUnresolved().catch(() => setUnresolved([]));
  }, [loadUnresolved]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reloadPlaces();
      await loadUnresolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function resolve(g: Unresolved, r: Resolution | undefined) {
    if (!r || r.type === 'skip') return;
    void run(async () => {
      const placeId =
        r.type === 'existing'
          ? r.placeId
          : (await store().createPlace({ name: r.name, region: r.region, kind: r.placeKind })).id;
      for (const text of g.texts) await store().resolveLocationText(text, placeId);
    });
  }

  const key = normalizeKey(query);
  const shown = places.filter(
    (p) =>
      (region === 'all' || p.region === region) &&
      (!key || [p.name, ...p.aliases].some((n) => normalizeKey(n).includes(key))),
  );

  return (
    <div className="stack-lg">
      {error && <p className="error">{error}</p>}

      <section className="card stack">
        <div>
          <h1 className="h1">מקומות שלא זוהו</h1>
          <p className="muted small">שורות מסידורים שכבר נשמרו, שהמקום שלהן עוד לא משויך. שיוך אחד מתקן את כל השורות.</p>
        </div>
        {unresolved === null && <p className="muted">טוען…</p>}
        {unresolved?.length === 0 && <p className="muted">✓ הכל משויך.</p>}
        {unresolved && unresolved.length > 0 && (
          <ul className="tasks">
            {unresolved.map((g) => (
              <li key={g.key} className="task">
                <div className="muted small">אחרון: {formatDayShort(g.lastDate)}</div>
                <PlaceResolver
                  group={{ ...g, candidates: lookupPlace(g.texts[0], index).candidates }}
                  value={undefined}
                  onChange={(r) => resolve(g, r)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <div className="row between wrap">
          <h2 className="h2">כל המקומות ({places.length})</h2>
        </div>
        <div className="row wrap">
          <input className="grow" placeholder="חיפוש…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={region} onChange={(e) => setRegion(e.target.value as Region | 'all')}>
            <option value="all">כל האזורים</option>
            {REGION_ORDER.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <ul className="list flush">
          {shown.slice(0, 200).map((p) => (
            <li key={p.id}>
              <button className="list-link" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                <span>
                  <span className={`dot region-${p.region}`} /> {p.name}
                </span>
                <span className="muted small">
                  {KIND_LABELS[p.kind]} · {REGION_LABELS[p.region]}
                </span>
              </button>
              {openId === p.id && (
                <PlaceEditor
                  place={p}
                  busy={busy}
                  onSave={(patch) => void run(() => store().updatePlace(p.id, patch))}
                  onMerge={(target) => void run(() => store().mergePlaces(p.id, target.id)).then(() => setOpenId(null))}
                  onDelete={() => void run(() => store().deletePlace(p.id)).then(() => setOpenId(null))}
                />
              )}
            </li>
          ))}
        </ul>
        {shown.length > 200 && <p className="muted small">מוצגים 200 ראשונים. אפשר לצמצם בחיפוש.</p>}
      </section>
    </div>
  );
}

function PlaceEditor({
  place,
  busy,
  onSave,
  onMerge,
  onDelete,
}: {
  place: Place;
  busy: boolean;
  onSave: (patch: Partial<Place>) => void;
  onMerge: (target: Place) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(place.name);
  const [region, setRegion] = useState<Region>(place.region);
  const [kind, setKind] = useState<PlaceKind>(place.kind);
  const [city, setCity] = useState(place.city ?? '');
  const [address, setAddress] = useState(place.address ?? '');
  const [aliases, setAliases] = useState(place.aliases.join('\n'));
  const [merging, setMerging] = useState(false);

  return (
    <div className="editor stack-sm">
      <label className="field">
        <span>שם</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row wrap">
        <label className="field grow">
          <span>אזור</span>
          <select value={region} onChange={(e) => setRegion(e.target.value as Region)}>
            {REGION_ORDER.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>סוג</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)}>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row wrap">
        <label className="field grow">
          <span>עיר</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label className="field grow">
          <span>כתובת</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>שמות נוספים (אחד בכל שורה)</span>
        <textarea rows={3} value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </label>
      <div className="row wrap">
        <button
          className="btn btn-primary btn-small"
          disabled={busy || !name.trim()}
          onClick={() =>
            onSave({
              name: name.trim(),
              region,
              kind,
              city: city.trim() || null,
              address: address.trim() || null,
              aliases: [...new Set(aliases.split('\n').map((a) => a.trim()).filter(Boolean))],
            })
          }
        >
          שמירה
        </button>
        <button className="btn btn-small" disabled={busy} onClick={() => setMerging(!merging)}>
          מיזוג לתוך מקום אחר
        </button>
        <button
          className="btn btn-small btn-danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`למחוק את "${place.name}"? משימות שמשויכות אליו יאבדו את השיוך. במקום כפול עדיף מיזוג.`)) onDelete();
          }}
        >
          מחיקה
        </button>
      </div>
      {merging && (
        <div className="stack-sm">
          <p className="small">
            כל המשימות והשמות של "{place.name}" יעברו למקום שנבחר, ו"{place.name}" יימחק.
          </p>
          <PlaceSearch
            excludeId={place.id}
            onPick={(target) => {
              if (window.confirm(`למזג את "${place.name}" לתוך "${target.name}"?`)) onMerge(target);
            }}
            onCancel={() => setMerging(false)}
          />
        </div>
      )}
    </div>
  );
}
