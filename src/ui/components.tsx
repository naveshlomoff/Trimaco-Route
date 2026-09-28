import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../appContext';
import type { Resolution, UnknownGroup } from '../lib/draft';
import { FLAG_LABELS, KIND_LABELS, KIND_ORDER, REGION_LABELS, REGION_ORDER, TYPE_LABELS } from '../lib/labels';
import { buildPlaceIndex, lookupPlace } from '../lib/parser';
import { normalizeKey } from '../lib/text';
import type { Place, PlaceKind, Region, TaskType } from '../lib/types';

export type TaskState = 'known' | 'inhouse' | 'none' | 'unknown';

export function TaskLine(props: {
  state: TaskState;
  placeName: string | null;
  region: Region | null;
  locationText: string | null;
  description: string;
  types: TaskType[];
  windowStart: string | null;
  windowEnd: string | null;
  flags: string[];
  address: string | null;
  children?: ReactNode;
}) {
  const { state, placeName, region, locationText, description, types, windowStart, windowEnd, flags, address } = props;
  const window =
    windowStart || windowEnd ? `${windowStart?.slice(0, 5) ?? ''}${windowStart && windowEnd ? '–' : ''}${windowEnd?.slice(0, 5) ?? ''}` : null;

  // Warehouse work is one quiet line: "במחסן · הכנת הזמנות"
  if (state === 'inhouse') {
    return (
      <li className="task task-inhouse">
        <div className="task-head">
          <span className="chip chip-muted">במחסן</span>
          {description && <span className="task-desc">{description}</span>}
        </div>
        {props.children}
      </li>
    );
  }

  return (
    <li className={`task task-${state}`}>
      <div className="task-head">
        {state === 'none' && <span className="chip chip-muted">בלי מיקום</span>}
        {state === 'unknown' && <span className="chip chip-warn">לא מזוהה: {locationText}</span>}
        {state === 'known' && (
          <span className={`chip region-${region ?? 'unknown'}`}>
            {placeName}
            <span className="chip-sub">{REGION_LABELS[region ?? 'unknown']}</span>
          </span>
        )}
        {address && <span className="muted small">{address}</span>}
      </div>
      {description && <div className="task-desc">{description}</div>}
      {(types.length > 0 || window || flags.length > 0) && (
        <div className="badges">
          {types.map((t) => (
            <span key={t} className="badge">
              {TYPE_LABELS[t] ?? t}
            </span>
          ))}
          {window && <span className="badge badge-time">⏱ {window}</span>}
          {flags.map((f) => (
            <span key={f} className="badge badge-flag">
              {FLAG_LABELS[f] ?? f}
            </span>
          ))}
        </div>
      )}
      {props.children}
    </li>
  );
}

/** Asks what an unrecognised place is: one of the guesses, a place from the list, or a new one. */
export function PlaceResolver({
  group,
  value,
  onChange,
}: {
  group: UnknownGroup;
  value: Resolution | undefined;
  onChange: (r: Resolution | undefined) => void;
}) {
  const { places } = useApp();
  const [mode, setMode] = useState<'idle' | 'search' | 'new'>('idle');

  if (value) {
    const label =
      value.type === 'existing'
        ? places.find((p) => p.id === value.placeId)?.name ?? 'מקום קיים'
        : `${value.name} (חדש · ${REGION_LABELS[value.region]})`;
    return (
      <div className="resolver resolver-done">
        <span>✓ {label}</span>
        <button className="link" onClick={() => onChange(undefined)}>
          שינוי
        </button>
      </div>
    );
  }

  return (
    <div className="resolver">
      <div className="small">
        מה זה <strong>{group.texts[0]}</strong>?{group.count > 1 ? ` (מופיע ${group.count} פעמים)` : ''}
      </div>
      <div className="row wrap">
        {group.candidates.map((c) => (
          <button key={c.placeId} className="btn btn-small" onClick={() => onChange({ type: 'existing', placeId: c.placeId })}>
            {c.name}?
          </button>
        ))}
        <button className="btn btn-small btn-ghost" onClick={() => setMode(mode === 'search' ? 'idle' : 'search')}>
          חיפוש ברשימה
        </button>
        <button className="btn btn-small btn-ghost" onClick={() => setMode(mode === 'new' ? 'idle' : 'new')}>
          מקום חדש
        </button>
      </div>
      {mode === 'search' && (
        <PlaceSearch
          onPick={(p) => {
            onChange({ type: 'existing', placeId: p.id });
            setMode('idle');
          }}
          onCancel={() => setMode('idle')}
        />
      )}
      {mode === 'new' && (
        <NewPlaceForm
          initialName={group.texts[0]}
          places={places}
          onSubmit={(n) => {
            onChange({ type: 'new', ...n });
            setMode('idle');
          }}
          onPickExisting={(p) => {
            onChange({ type: 'existing', placeId: p.id });
            setMode('idle');
          }}
          onCancel={() => setMode('idle')}
        />
      )}
    </div>
  );
}

export function PlaceSearch({
  onPick,
  onCancel,
  excludeId,
}: {
  onPick: (p: Place) => void;
  onCancel?: () => void;
  excludeId?: string;
}) {
  const { places } = useApp();
  const [q, setQ] = useState('');
  const key = normalizeKey(q);
  const results = key
    ? places
        .filter((p) => p.id !== excludeId && [p.name, ...p.aliases].some((n) => normalizeKey(n).includes(key)))
        .slice(0, 8)
    : [];
  return (
    <div className="search-box">
      <input autoFocus placeholder="הקלדת שם המקום…" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((p) => (
            <li key={p.id}>
              <button onClick={() => onPick(p)}>
                <span>{p.name}</span>
                <span className="muted small">{REGION_LABELS[p.region]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {key && results.length === 0 && <p className="muted small">לא נמצא מקום כזה.</p>}
      {onCancel && (
        <button className="btn btn-ghost btn-small" onClick={onCancel}>
          ביטול
        </button>
      )}
    </div>
  );
}

function NewPlaceForm({
  initialName,
  places,
  onSubmit,
  onPickExisting,
  onCancel,
}: {
  initialName: string;
  places: Place[];
  onSubmit: (p: { name: string; region: Region; placeKind: PlaceKind }) => void;
  onPickExisting: (p: Place) => void;
  onCancel: () => void;
}) {
  const index = useMemo(() => buildPlaceIndex(places), [places]);
  const [name, setName] = useState(initialName);
  const [region, setRegion] = useState<Region>(() => lookupPlace(initialName, index).place?.region ?? 'unknown');
  const [kind, setKind] = useState<PlaceKind>('customer');
  const duplicate = places.find((p) => normalizeKey(p.name) === normalizeKey(name));

  return (
    <div className="new-place stack-sm">
      <label className="field">
        <span>שם המקום</span>
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
            {KIND_ORDER.filter((k) => k !== 'depot').map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {duplicate && (
        <p className="small">
          כבר יש מקום בשם הזה.{' '}
          <button className="link" onClick={() => onPickExisting(duplicate)}>
            לבחור בו
          </button>
        </p>
      )}
      <div className="row">
        <button
          className="btn btn-primary btn-small"
          disabled={!name.trim() || !!duplicate}
          onClick={() => onSubmit({ name: name.trim(), region, placeKind: kind })}
        >
          הוספה
        </button>
        <button className="btn btn-ghost btn-small" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}

export function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="tile">
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}
