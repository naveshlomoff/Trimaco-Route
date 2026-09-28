import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { formatDayShort, toISODate } from '../../lib/dates';
import { REGION_LABELS, REGION_ORDER } from '../../lib/labels';
import { computeDashboard } from '../../lib/stats';
import { store } from '../../lib/store';
import type { TaskRow } from '../../lib/types';
import { Tile } from '../components';

const RANGES = [
  { days: 30, label: '30 יום' },
  { days: 90, label: '3 חודשים' },
  { days: 365, label: 'שנה' },
];

export function Dashboard() {
  const { workers, places } = useApp();
  const [range, setRange] = useState(90);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setTasks(null);
    const from = new Date();
    from.setDate(from.getDate() - range);
    const to = new Date();
    to.setDate(to.getDate() + 14);
    store()
      .tasksBetween(toISODate(from), toISODate(to))
      .then((t) => alive && setTasks(t))
      .catch(() => alive && setTasks([]));
    return () => {
      alive = false;
    };
  }, [range]);

  const data = useMemo(() => (tasks ? computeDashboard(tasks, workers, places) : null), [tasks, workers, places]);
  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? id;

  return (
    <div className="stack-lg">
      <section className="stack-sm">
        <div className="row between wrap">
          <h1 className="h1">לוח מנהל</h1>
          <div className="segmented">
            {RANGES.map((r) => (
              <button key={r.days} className={r.days === range ? 'seg seg-active' : 'seg'} onClick={() => setRange(r.days)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          שלב א׳: המערכת לומדת מהסידורים של עדי. זמני נסיעה ופקקים יתווספו כשנחבר את Google Maps.
        </p>
      </section>

      {!data && <p className="muted">טוען…</p>}

      {data && data.days === 0 && (
        <section className="card">
          <p>אין עדיין סידורים בתקופה הזו. אפשר להתחיל בהדבקת סידור, או בייבוא ההיסטוריה מהווטסאפ.</p>
          <a className="btn btn-primary" href="#/admin/import">
            ייבוא מהווטסאפ
          </a>
        </section>
      )}

      {data && data.days > 0 && (
        <>
          <section className="tiles">
            <Tile label="ימי עבודה מתועדים" value={data.days} />
            <Tile label="עצירות בשטח" value={data.fieldStops} />
            <Tile label="עצירות ליום בממוצע" value={data.avgStopsPerDay.toFixed(1)} />
            <Tile label="ימים עם חפיפה באזור" value={new Set(data.overlaps.map((o) => o.date)).size} />
          </section>

          {data.unresolvedTexts > 0 && (
            <a className="notice" href="#/admin/places">
              {data.unresolvedTexts} מקומות עוד לא זוהו. לחיצה כאן כדי לשייך אותם.
            </a>
          )}

          <section className="card stack">
            <div>
              <h2 className="h2">הזדמנויות לאיחוד מסלולים</h2>
              <p className="muted small">ימים שבהם שני נהגים או יותר נסעו לאותו אזור. כאן נמצא החיסכון הפוטנציאלי.</p>
            </div>
            <div className="row wrap">
              {REGION_ORDER.filter((r) => data.overlapDaysByRegion[r]).map((r) => (
                <span key={r} className={`chip region-${r}`}>
                  {REGION_LABELS[r]}: {data.overlapDaysByRegion[r]} ימים
                </span>
              ))}
            </div>
            {data.overlaps.length === 0 && <p className="muted">לא נמצאו חפיפות בתקופה הזו.</p>}
            <ul className="overlaps">
              {(showAll ? data.overlaps : data.overlaps.slice(0, 12)).map((o, i) => (
                <li key={i}>
                  <a href={`#/day/${o.date}`} className="overlap-date">
                    {formatDayShort(o.date)}
                  </a>
                  <span className={`chip region-${o.region}`}>{REGION_LABELS[o.region]}</span>
                  <span className="overlap-body">
                    {o.entries.map((e, j) => (
                      <span key={e.workerId}>
                        {j > 0 && ' · '}
                        <strong>{workerName(e.workerId)}</strong>: {e.places.join(', ')}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {data.overlaps.length > 12 && (
              <button className="link" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'פחות' : `הצגת כל ${data.overlaps.length}`}
              </button>
            )}
          </section>

          <section className="card stack">
            <h2 className="h2">לפי עובד</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>עובד</th>
                    <th>ימים בשטח</th>
                    <th>עצירות</th>
                    <th>ממוצע ליום בשטח</th>
                    <th>ימי מחסן</th>
                    <th>אזורים עיקריים</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workers.map((w) => (
                    <tr key={w.workerId}>
                      <td>{w.name}</td>
                      <td>{w.fieldDays}</td>
                      <td>{w.fieldStops}</td>
                      <td>{w.fieldDays ? (w.fieldStops / w.fieldDays).toFixed(1) : '–'}</td>
                      <td>{w.warehouseDays}</td>
                      <td>{w.topRegions.map((r) => REGION_LABELS[r.region]).join(', ') || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card stack">
            <h2 className="h2">המקומות הכי מבוקרים</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>מקום</th>
                    <th>אזור</th>
                    <th>ימי ביקור</th>
                    <th>בדרך כלל</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPlaces.map((p) => (
                    <tr key={p.placeId}>
                      <td>{p.name}</td>
                      <td>{REGION_LABELS[p.region]}</td>
                      <td>{p.visits}</td>
                      <td>{p.topWorker ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
