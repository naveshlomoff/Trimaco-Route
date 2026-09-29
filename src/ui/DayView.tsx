import { useEffect, useState } from 'react';
import { navigate, useApp } from '../appContext';
import { formatDayLong } from '../lib/dates';
import { writeDraft } from '../lib/draft';
import { store } from '../lib/store';
import { adviseDay } from '../lib/advisor';
import { toAdviceTasks } from '../lib/shadow';
import type { DayRow, TaskRow } from '../lib/types';
import { AdviceMoves, fmtHm, stopsLabel } from './Advice';
import { TaskLine } from './components';
import { SAVED_FLAG } from './Review';

function readFlag(): string | null {
  try {
    return sessionStorage.getItem(SAVED_FLAG);
  } catch {
    return null;
  }
}

function clearFlag(): void {
  try {
    sessionStorage.removeItem(SAVED_FLAG);
  } catch {
    /* ignore */
  }
}

export function DayView({ date }: { date: string }) {
  const { workers, places, profile } = useApp();
  const [data, setData] = useState<{ day: DayRow; tasks: TaskRow[] } | null | undefined>(undefined);
  const [justSaved] = useState(() => readFlag() === date);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => clearFlag(), []);

  useEffect(() => {
    store()
      .getDay(date)
      .then(setData)
      .catch(() => setData(null));
  }, [date]);

  if (data === undefined) return <p className="muted">טוען…</p>;
  if (data === null) {
    return (
      <div className="card stack">
        <p>לא נמצא סידור ליום הזה.</p>
        <a href="#/">חזרה</a>
      </div>
    );
  }

  const { day, tasks } = data;
  const order = new Map(workers.map((w, i) => [w.id, i]));
  const groups = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const k = t.worker_id ?? t.worker_label;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const sorted = [...groups].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
  const fieldStops = tasks.filter((t) => t.is_field).length;
  const advice = profile.role === 'admin' ? adviseDay(toAdviceTasks(tasks, places), { places, workers }) : null;
  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? id;

  function edit() {
    writeDraft({ text: day.raw_text, date: day.date });
    navigate('/review');
  }

  async function remove() {
    if (!window.confirm(`למחוק את הסידור של ${formatDayLong(date)}?`)) return;
    await store().deleteDay(date);
    navigate('/');
  }

  return (
    <div className="stack-lg">
      {justSaved && <div className="notice notice-ok">✓ הסידור נשמר</div>}
      <section className="card stack-sm">
        <h1 className="h1">{formatDayLong(date)}</h1>
        <p className="muted small">
          {groups.size} עובדים · {fieldStops} עצירות בשטח ·{' '}
          {day.source === 'whatsapp_export' ? 'יובא מהווטסאפ' : 'הודבק'}
          {day.version > 1 ? ` · עודכן ${day.version - 1}×` : ''}
        </p>
        <div className="row wrap">
          <button className="btn btn-small" onClick={edit}>
            עדכון הסידור
          </button>
          {profile.role === 'admin' && (
            <button className="btn btn-small btn-danger" onClick={() => void remove()}>
              מחיקה
            </button>
          )}
        </div>
      </section>

      {advice && advice.before.length > 0 && (
        <section className="card stack-sm">
          <h2 className="h2">מה המנוע היה מציע</h2>
          <AdviceMoves advice={advice} workerName={workerName} />
          <h3 className="h3">יום משוער לכל נהג (נהיגה ועצירות)</h3>
          <ul className="plain">
            {advice.before.map((p) => {
              const after = advice.after.find((q) => q.workerId === p.workerId);
              const changed = advice.moves.length > 0 && after && Math.round(after.totalMin) !== Math.round(p.totalMin);
              return (
                <li key={p.workerId}>
                  {p.name}: {fmtHm(p.totalMin)}
                  {changed && ` ← ${after.stops.length ? fmtHm(after.totalMin) : 'בלי שטח'}`}
                  <span className="muted small">
                    {' '}
                    · {stopsLabel(p.stops.length)}, {Math.round(p.route.km)} ק"מ
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">הערכה לפי מרחק על המפה, בלי פקקים. רק מנהלים רואים את זה.</p>
        </section>
      )}

      {sorted.map(([key, list]) => {
        const worker = workers.find((w) => w.id === key);
        return (
          <section key={key} className="card stack-sm">
            <h2 className="h2">{worker?.name ?? list[0].worker_label}</h2>
            <ul className="tasks">
              {list.map((t) => {
                const place = t.place_id ? places.find((p) => p.id === t.place_id) : undefined;
                const state = !t.is_field
                  ? 'inhouse'
                  : place
                    ? 'known'
                    : t.location_text
                      ? 'unknown'
                      : 'none';
                return (
                  <TaskLine
                    key={t.id}
                    state={state}
                    placeName={place?.name ?? null}
                    region={place?.region ?? null}
                    locationText={t.location_text}
                    description={t.description ?? ''}
                    types={t.task_types}
                    windowStart={t.window_start}
                    windowEnd={t.window_end}
                    flags={t.flags}
                    address={t.address}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}

      {(day.vehicle_notes.length > 0 || day.notes.length > 0) && (
        <section className="card stack-sm">
          {day.vehicle_notes.length > 0 && (
            <>
              <h2 className="h2">סידור רכב</h2>
              <ul className="plain">
                {day.vehicle_notes.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </>
          )}
          {day.notes.length > 0 && (
            <>
              <h2 className="h2">הערות</h2>
              <ul className="plain">
                {day.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="card stack-sm">
        <button className="link" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? 'הסתרת ההודעה המקורית' : 'ההודעה המקורית'}
        </button>
        {showRaw && <pre className="raw">{day.raw_text}</pre>}
      </section>
    </div>
  );
}
