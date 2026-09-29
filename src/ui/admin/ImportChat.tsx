import { unzipSync } from 'fflate';
import { useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { formatDayShort } from '../../lib/dates';
import { applyResolutions, buildSaveInput, collectUnknowns, type Resolution } from '../../lib/draft';
import { historyRawText, readHistory, type HistoryDay } from '../../lib/history';
import { syncSeedPlaces } from '../../lib/seed';
import { store } from '../../lib/store';
import { PlaceResolver } from '../components';

type Phase =
  | { step: 'pick' }
  | { step: 'reading' }
  | { step: 'review'; messages: number; days: HistoryDay[]; existing: Set<string>; addons: number }
  | { step: 'saving'; done: number; total: number }
  | { step: 'done'; saved: number; skipped: number };

async function readExport(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith('.zip')) return file.text();
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const name = Object.keys(files).find((n) => n.toLowerCase().endsWith('.txt'));
  if (!name) throw new Error('בקובץ ה-zip אין קובץ טקסט של השיחה');
  return new TextDecoder('utf-8').decode(files[name]);
}

export function ImportChat() {
  const { workers, places, reloadPlaces } = useApp();
  const [phase, setPhase] = useState<Phase>({ step: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [overwrite, setOverwrite] = useState(false);

  const unknowns = useMemo(() => (phase.step === 'review' ? collectUnknowns(phase.days.map((d) => d.day)) : []), [phase]);
  const pending = unknowns.filter((g) => !resolutions.has(g.key)).length;

  async function onFile(file: File) {
    setError(null);
    setPhase({ step: 'reading' });
    try {
      const text = await readExport(file);
      // first bring the catalog up to date with the built-in list of hospitals and cities
      await syncSeedPlaces(places);
      const fresh = await store().loadPlaces();
      await reloadPlaces();
      const history = readHistory(text, { workers, places: fresh });
      const existing = await store().existingDates(history.days.map((d) => d.date));
      setResolutions(new Map());
      setPhase({
        step: 'review',
        messages: history.messageCount,
        days: history.days,
        existing,
        addons: history.days.reduce((s, d) => s + d.messages.length - 1, 0),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase({ step: 'pick' });
    }
  }

  async function save() {
    if (phase.step !== 'review') return;
    const review = phase;
    const toSave = review.days.filter((d) => overwrite || !review.existing.has(d.date));
    setError(null);
    setPhase({ step: 'saving', done: 0, total: toSave.length });
    try {
      const ids = await applyResolutions(unknowns, resolutions, await store().loadPlaces());
      let done = 0;
      for (const d of toSave) {
        await store().saveDay(
          buildSaveInput(
            d.day,
            {
              date: d.date,
              rawText: historyRawText(d),
              source: 'whatsapp_export',
              messageSentAt: d.messages[0].sentAt.toISOString(),
            },
            ids,
          ),
        );
        done++;
        setPhase({ step: 'saving', done, total: toSave.length });
      }
      await reloadPlaces();
      setPhase({ step: 'done', saved: done, skipped: review.days.length - toSave.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase(review);
      await reloadPlaces().catch(() => undefined);
    }
  }

  return (
    <div className="stack-lg">
      <section className="card stack">
        <h1 className="h1">ייבוא היסטוריה מהווטסאפ</h1>
        <p className="muted">
          בטלפון: נכנסים לקבוצה, לוחצים על שם הקבוצה, ואז "ייצוא צ'אט" ו"בלי מדיה". את הקובץ שמתקבל (zip או txt) בוחרים
          כאן. מהשיחה נקראות רק הודעות הסידור, וההודעות האחרות לא נשמרות.
        </p>
        {(phase.step === 'pick' || phase.step === 'review') && (
          <input
            type="file"
            accept=".txt,.zip,text/plain,application/zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        )}
        {phase.step === 'reading' && <p className="muted">קורא את השיחה…</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {phase.step === 'review' && (
        <>
          <section className="card stack-sm">
            <h2 className="h2">מה נמצא</h2>
            <p>
              {phase.messages.toLocaleString('he-IL')} הודעות בשיחה, מתוכן <strong>{phase.days.length} ימי עבודה</strong>
              {phase.days.length > 0 &&
                ` (${formatDayShort(phase.days[0].date)} עד ${formatDayShort(phase.days[phase.days.length - 1].date)})`}
              .{phase.addons > 0 && ` ${phase.addons} תוספות לסידור צורפו ליום שלהן.`}
            </p>
            {phase.existing.size > 0 && (
              <label className="check">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                <span>{phase.existing.size} מהימים כבר שמורים. לדרוס אותם בגרסה מהווטסאפ?</span>
              </label>
            )}
          </section>

          {unknowns.length > 0 && (
            <section className="card stack">
              <div>
                <h2 className="h2">
                  מקומות שלא זוהו ({pending} מתוך {unknowns.length} עוד פתוחים)
                </h2>
                <p className="muted small">
                  כל מה שמשייכים כאן נלמד גם לפעמים הבאות. שם של אדם או הערה: "לא מקום". אפשר גם להשאיר פתוח ולהשלים
                  אחר כך במסך המקומות.
                </p>
              </div>
              <ul className="tasks">
                {unknowns.map((g) => (
                  <li key={g.key} className="task">
                    <PlaceResolver
                      group={g}
                      value={resolutions.get(g.key)}
                      allowSkip
                      onChange={(r) =>
                        setResolutions((prev) => {
                          const next = new Map(prev);
                          if (r) next.set(g.key, r);
                          else next.delete(g.key);
                          return next;
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card stack-sm">
            <button className="btn btn-primary btn-block" disabled={phase.days.length === 0} onClick={() => void save()}>
              שמירת {phase.days.filter((d) => overwrite || !phase.existing.has(d.date)).length} ימים
            </button>
          </section>
        </>
      )}

      {phase.step === 'saving' && (
        <section className="card stack-sm">
          <p>
            שומר… {phase.done} מתוך {phase.total}
          </p>
          <progress max={phase.total} value={phase.done} />
        </section>
      )}

      {phase.step === 'done' && (
        <section className="card stack-sm">
          <p className="notice notice-ok">
            ✓ נשמרו {phase.saved} ימים{phase.skipped ? `, ${phase.skipped} ימים שכבר היו שמורים לא שונו` : ''}.
          </p>
          <div className="row">
            <a className="btn btn-primary" href="#/admin">
              ללוח המנהל
            </a>
            <button className="btn" onClick={() => setPhase({ step: 'pick' })}>
              ייבוא נוסף
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
