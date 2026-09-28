import { unzipSync } from 'fflate';
import { useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { formatDayShort, resolveDate } from '../../lib/dates';
import { applyResolutions, buildSaveInput, collectUnknowns, type Resolution } from '../../lib/draft';
import { looksLikeSchedule, parseSchedule } from '../../lib/parser';
import { store } from '../../lib/store';
import type { ParsedDay } from '../../lib/types';
import { parseChatExport, type ChatMessage } from '../../lib/whatsapp';
import { PlaceResolver } from '../components';

interface Found {
  date: string;
  message: ChatMessage;
  day: ParsedDay;
}

type Phase =
  | { step: 'pick' }
  | { step: 'review'; messages: number; found: Found[]; existing: Set<string> }
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

  const unknowns = useMemo(() => (phase.step === 'review' ? collectUnknowns(phase.found.map((f) => f.day)) : []), [phase]);

  async function onFile(file: File) {
    setError(null);
    try {
      const text = await readExport(file);
      const messages = parseChatExport(text);
      const byDate = new Map<string, Found>();
      for (const m of messages) {
        if (!looksLikeSchedule(m.text, workers)) continue;
        const day = parseSchedule(m.text, { workers, places });
        const date = resolveDate(day.dateHint, m.sentAt);
        const prev = byDate.get(date);
        // a later message for the same day is a corrected schedule
        if (!prev || prev.message.sentAt <= m.sentAt) byDate.set(date, { date, message: m, day });
      }
      const found = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      const existing = await store().existingDates(found.map((f) => f.date));
      setResolutions(new Map());
      setPhase({ step: 'review', messages: messages.length, found, existing });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save() {
    if (phase.step !== 'review') return;
    const toSave = phase.found.filter((f) => overwrite || !phase.existing.has(f.date));
    setError(null);
    setPhase({ step: 'saving', done: 0, total: toSave.length });
    try {
      const ids = await applyResolutions(unknowns, resolutions, places);
      let done = 0;
      for (const f of toSave) {
        await store().saveDay(
          buildSaveInput(
            f.day,
            { date: f.date, rawText: f.message.text, source: 'whatsapp_export', messageSentAt: f.message.sentAt.toISOString() },
            ids,
          ),
        );
        done++;
        setPhase({ step: 'saving', done, total: toSave.length });
      }
      await reloadPlaces();
      setPhase({ step: 'done', saved: done, skipped: phase.found.length - toSave.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase(phase);
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
        {error && <p className="error">{error}</p>}
      </section>

      {phase.step === 'review' && (
        <>
          <section className="card stack-sm">
            <h2 className="h2">מה נמצא</h2>
            <p>
              {phase.messages} הודעות בשיחה, מתוכן <strong>{phase.found.length} סידורי עבודה</strong>
              {phase.found.length > 0 &&
                ` (${formatDayShort(phase.found[0].date)} עד ${formatDayShort(phase.found[phase.found.length - 1].date)})`}
              .
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
                <h2 className="h2">מקומות שלא זוהו ({unknowns.length})</h2>
                <p className="muted small">
                  כל מה שמשייכים כאן נלמד גם לפעמים הבאות. אפשר לדלג, ולהשלים אחר כך במסך המקומות.
                </p>
              </div>
              <ul className="tasks">
                {unknowns.map((g) => (
                  <li key={g.key} className="task">
                    <PlaceResolver
                      group={g}
                      value={resolutions.get(g.key)}
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
            <button className="btn btn-primary btn-block" disabled={phase.found.length === 0} onClick={() => void save()}>
              שמירת {phase.found.filter((f) => overwrite || !phase.existing.has(f.date)).length} ימים
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
