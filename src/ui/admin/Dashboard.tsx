import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { formatDayShort, toISODate } from '../../lib/dates';
import { REGION_LABELS, REGION_ORDER } from '../../lib/labels';
import { seedSyncNeeded, syncSeedPlaces } from '../../lib/seed';
import { computeShadow } from '../../lib/shadow';
import { computeDashboard } from '../../lib/stats';
import { store } from '../../lib/store';
import type { TaskRow } from '../../lib/types';
import { AdviceMoves, fmtHm } from '../Advice';
import { Tile } from '../components';

const RANGES = [
  { days: 30, label: '30 יום' },
  { days: 90, label: '3 חודשים' },
  { days: 365, label: 'שנה' },
];

export function Dashboard() {
  const { workers, places, reloadPlaces } = useApp();
  const [range, setRange] = useState(90);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showAllAdvice, setShowAllAdvice] = useState(false);
  const [locating, setLocating] = useState(false);

  // Places need map coordinates for the advisor: fill them in from the built-in list once.
  useEffect(() => {
    if (!seedSyncNeeded(places)) return;
    setLocating(true);
    syncSeedPlaces(places)
      .then(() => reloadPlaces())
      .catch(() => undefined)
      .finally(() => setLocating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const shadow = useMemo(
    () => (tasks && !locating ? computeShadow(tasks, places, workers) : null),
    [tasks, workers, places, locating],
  );
  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? id;
  const adviceDays = shadow ? shadow.days.filter((d) => d.advice.moves.length > 0) : [];
  const bestDays = [...adviceDays].sort((a, b) => b.advice.savedMin - a.advice.savedMin);

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
          כל המספרים נלמדים מהסידורים של עדי. זמני הנסיעה הם הערכה לפי מרחק על המפה, בלי פקקים.
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
              {data.unresolvedTexts === 1
                ? 'מקום אחד עוד לא זוהה. לחיצה כאן כדי לשייך אותו.'
                : `${data.unresolvedTexts} מקומות עוד לא זוהו. לחיצה כאן כדי לשייך אותם.`}
            </a>
          )}

          <section className="card stack">
            <div>
              <h2 className="h2">מה המנוע היה משנה</h2>
              <p className="muted small">
                המנוע עבר על כל יום ובדק אילו עצירות היה עדיף לתת לנהג אחר שכבר נמצא עד 15 ק"מ משם, בלי שיום העבודה
                שלו יעבור את 17:00. עדי לא רואה את זה עדיין.
              </p>
            </div>
            {locating && <p className="muted">מעדכן מיקומים על המפה…</p>}
            {shadow && (
              <>
                <div className="tiles">
                  <Tile label="ימים עם הצעה" value={`${shadow.daysWithAdvice} מתוך ${shadow.days.length}`} />
                  <Tile
                    label="שעות נהיגה שנחסכות"
                    value={Math.round(shadow.savedMin / 60)}
                    hint={`${shadow.driveMin ? Math.round((100 * shadow.savedMin) / shadow.driveMin) : 0}% מהנהיגה`}
                  />
                  <Tile
                    label="חיסכון ביום עם הצעה"
                    value={`${shadow.daysWithAdvice ? Math.round(shadow.savedMin / shadow.daysWithAdvice) : 0} דק׳`}
                  />
                  <Tile label="פעמים שנהג מתפנה למחסן" value={shadow.freedDriverDays} />
                </div>

                <h3 className="h3">עומס לפי נהג (הערכה)</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>נהג</th>
                        <th>ימים בשטח</th>
                        <th>יום ממוצע</th>
                        <th>מתוכו נהיגה</th>
                        <th>ניצולת 9:00–17:00</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shadow.drivers.map((d) => (
                        <tr key={d.workerId}>
                          <td>{d.name}</td>
                          <td>{d.days}</td>
                          <td>{fmtHm(d.avgDayMin)}</td>
                          <td>{fmtHm(d.avgDriveMin)}</td>
                          <td>
                            <span className="bar">
                              <span style={{ width: `${Math.min(100, Math.round(d.utilization * 100))}%` }} />
                            </span>{' '}
                            {Math.round(d.utilization * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 className="h3">הימים עם החיסכון הגדול ביותר</h3>
                <ul className="overlaps">
                  {(showAllAdvice ? bestDays : bestDays.slice(0, 8)).map((d) => (
                    <li key={d.date} className="stack-sm">
                      <div className="row wrap">
                        <a href={`#/day/${d.date}`} className="overlap-date">
                          {formatDayShort(d.date)}
                        </a>
                        <span className="chip chip-ok">−{d.advice.savedMin} דק׳ נהיגה</span>
                      </div>
                      <AdviceMoves advice={d.advice} workerName={workerName} />
                    </li>
                  ))}
                </ul>
                {bestDays.length > 8 && (
                  <button className="link" onClick={() => setShowAllAdvice(!showAllAdvice)}>
                    {showAllAdvice ? 'פחות' : `הצגת כל ${bestDays.length} הימים`}
                  </button>
                )}
              </>
            )}
          </section>

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
