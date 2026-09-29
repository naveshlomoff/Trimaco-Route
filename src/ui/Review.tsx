import { useEffect, useMemo, useState } from 'react';
import { navigate, useApp } from '../appContext';
import { adviseDay, fixedTasks, type Move } from '../lib/advisor';
import { formatDayLong, resolveDate } from '../lib/dates';
import {
  appendToSaved,
  applyResolutions,
  buildSaveInput,
  collectUnknowns,
  readDraft,
  writeDraft,
  type Resolution,
} from '../lib/draft';
import { parseSchedule } from '../lib/parser';
import { canRewrite, rewriteMove } from '../lib/rewrite';
import { store } from '../lib/store';
import { normalizeKey } from '../lib/text';
import type { AdviceDecisionKind, ParsedTask, Region } from '../lib/types';
import { PlaceResolver, TaskLine, type TaskState } from './components';
import { moveKey, Suggestions, type Applied } from './Suggestions';

export const SAVED_FLAG = 'trimaco-route-saved';

export function Review() {
  const { workers, places, reloadPlaces } = useApp();
  const draft = useMemo(() => readDraft(), []);
  // the message changes when a suggestion is accepted
  const [text, setText] = useState(() => draft?.text ?? '');
  const parsed = useMemo(() => (text ? parseSchedule(text, { workers, places }) : null), [text, workers, places]);
  // an add-on with no day word ("מוסיפה לסידור:") is for today's schedule
  const [date, setDate] = useState(() => {
    if (draft?.date) return draft.date;
    if (!parsed) return '';
    const hint = parsed.kind === 'addendum' && parsed.dateHint.kind === 'none' ? { kind: 'today' as const } : parsed.dateHint;
    return resolveDate(hint, new Date());
  });
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState<Set<string>>(() => new Set());
  const [applied, setApplied] = useState<Applied[]>([]);

  useEffect(() => {
    if (!draft) navigate('/');
  }, [draft]);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    store()
      .existingDates([date])
      .then((s) => alive && setExists(s.has(date)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [date]);

  const unknowns = useMemo(() => (parsed ? collectUnknowns([parsed]) : []), [parsed]);

  // Suggestions for a full schedule (not for a few lines added to one).
  const advice = useMemo(() => {
    if (!parsed || parsed.kind !== 'full') return null;
    const facts = parsed.sections.flatMap((s) => s.tasks).map((t) => ({
      workerId: t.workerId,
      placeId: placeIdOf(t, resolutions),
      isField: t.isField,
      types: t.types,
      timed: Boolean(t.windowStart || t.windowEnd),
      description: t.description,
    }));
    const fixed = fixedTasks(facts, places);
    const tasks = facts.map((t, i) => ({ ...t, fixed: fixed[i] }));
    // never offer to move back a stop just moved
    const movedBack = (m: { placeId: string; from: string; to: string }) =>
      applied.some((a) => a.move.placeId === m.placeId && a.move.from === m.to && a.move.to === m.from);
    return adviseDay(tasks, { places, workers }, { allow: (m) => !declined.has(moveKey(m)) && !movedBack(m) });
  }, [parsed, places, workers, resolutions, declined, applied]);

  if (!draft || !parsed) return null;

  const groupByKey = new Map(unknowns.map((g) => [g.key, g]));
  const allTasks = parsed.sections.flatMap((s) => s.tasks);
  const fieldStops = allTasks.filter((t) => t.isField).length;
  const pending = unknowns.filter((g) => !resolutions.has(g.key)).length;
  const shownFor = new Set<string>(); // each unknown place gets one resolver, on its first line

  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? id;
  const placeOf = (t: ParsedTask) => placeIdOf(t, resolutions);

  function changeText(next: string) {
    setText(next);
    writeDraft({ ...draft, text: next });
  }

  // Each answer is recorded right away, so it counts even if the day is never saved here.
  function record(moves: Move[], decision: AdviceDecisionKind, keepExisting = false) {
    if (!date || moves.length === 0) return;
    const rows = moves.map((m) => ({
      date,
      place_id: m.placeId,
      place_name: m.placeName,
      from_worker: m.from,
      to_worker: m.to,
      saved_min: m.savedMin,
      saved_km: m.savedKm,
      decision,
    }));
    store()
      .recordAdvice(rows, { keepExisting })
      .catch(() => undefined);
  }

  function accept(m: Move) {
    if (!parsed) return;
    const out = rewriteMove(text, parsed, m, placeOf);
    if (!out) return;
    setApplied((a) => [...a, { move: m, before: text, freed: out.freed }]);
    changeText(out.text);
    record([m], 'accepted');
  }

  function decline(m: Move) {
    setDeclined((d) => new Set(d).add(moveKey(m)));
    record([m], 'declined');
  }

  function undo() {
    const last = applied[applied.length - 1];
    if (!last) return;
    setApplied((a) => a.slice(0, -1));
    changeText(last.before);
    record([last.move], 'ignored');
  }

  function setResolution(key: string, r: Resolution | undefined) {
    setResolutions((prev) => {
      const next = new Map(prev);
      if (r) next.set(key, r);
      else next.delete(key);
      return next;
    });
  }

  function stateOf(t: ParsedTask): { state: TaskState; name: string | null; region: Region | null } {
    if (t.match === 'inhouse') return { state: 'inhouse', name: null, region: null };
    if (t.placeId) {
      const p = places.find((x) => x.id === t.placeId);
      return { state: 'known', name: p?.name ?? t.locationText, region: regionOf(p?.region) };
    }
    if (t.match === 'unknown' && t.locationText) {
      const r = resolutions.get(normalizeKey(t.locationText));
      if (r?.type === 'existing') {
        const p = places.find((x) => x.id === r.placeId);
        return { state: 'known', name: p?.name ?? null, region: regionOf(p?.region) };
      }
      if (r?.type === 'new') return { state: 'known', name: r.name, region: r.region };
      if (r?.type === 'skip') return { state: 'none', name: null, region: null };
      return { state: 'unknown', name: null, region: null };
    }
    return { state: 'none', name: null, region: null };
  }

  async function save() {
    if (!parsed || !draft) return;
    const question =
      pending === 1
        ? 'מקום אחד עוד לא זוהה. לשמור בכל זאת? אפשר להשלים אותו אחר כך.'
        : `${pending} מקומות עוד לא זוהו. לשמור בכל זאת? אפשר להשלים אותם אחר כך.`;
    if (pending > 0 && !window.confirm(question)) return;
    setSaving(true);
    setError(null);
    try {
      const ids = await applyResolutions(unknowns, resolutions, places);
      const input = buildSaveInput(parsed, { date, rawText: text, source: 'paste', messageSentAt: null }, ids);
      // an add-on joins the schedule already saved for the day instead of replacing it
      const saved = parsed.kind === 'addendum' ? await store().getDay(date) : null;
      await store().saveDay(saved ? appendToSaved(saved, input) : input);
      record(advice?.moves ?? [], 'ignored', true); // shown, and neither taken nor skipped
      await reloadPlaces();
      writeDraft(null);
      try {
        sessionStorage.setItem(SAVED_FLAG, date);
      } catch {
        /* the "saved" banner is optional */
      }
      navigate(`/day/${date}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
      await reloadPlaces().catch(() => undefined);
    }
  }

  return (
    <div className="stack-lg with-footer">
      <section className="card stack">
        <div className="row between wrap">
          <h1 className="h1">בדיקה לפני שמירה</h1>
          <button className="btn btn-ghost btn-small" onClick={() => navigate('/')}>
            חזרה לעריכה
          </button>
        </div>
        <label className="field">
          <span>הסידור הוא ליום</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </label>
        <p className="muted small">{date && formatDayLong(date)}</p>
        {parsed.kind === 'addendum' ? (
          <p className="notice">
            {exists
              ? 'זו תוספת לסידור. המשימות יתווספו לסידור שכבר שמור ליום הזה.'
              : 'זו תוספת לסידור, אבל אין סידור שמור ליום הזה. היא תישמר כסידור של היום.'}
          </p>
        ) : (
          exists && <p className="notice">כבר נשמר סידור ליום הזה. שמירה תעדכן אותו (הגרסה הקודמת נשמרת בהיסטוריה).</p>
        )}
        <div className="row wrap">
          <span className="chip chip-muted">{parsed.sections.length} עובדים</span>
          <span className="chip chip-muted">{fieldStops} עצירות בשטח</span>
          {unknowns.length > 0 && (
            <span className={pending ? 'chip chip-warn' : 'chip chip-ok'}>
              {pending === 0 ? 'כל המקומות זוהו' : pending === 1 ? 'מקום אחד לא מזוהה' : `${pending} מקומות לא מזוהים`}
            </span>
          )}
        </div>
      </section>

      {advice && (
        <Suggestions
          advice={advice}
          applied={applied}
          canApply={(m) => canRewrite(parsed, m, placeOf)}
          onAccept={accept}
          onDecline={decline}
          onUndo={undo}
          text={text}
          workerName={workerName}
        />
      )}

      {parsed.sections.length === 0 && (
        <section className="card">
          <p>לא מצאתי בהודעה שמות של עובדים. בודקים שזו הודעת הסידור המלאה, ושכל שם עובד מופיע בשורה נפרדת.</p>
        </section>
      )}

      {parsed.sections.map((section, i) => (
        <section key={i} className="card stack-sm">
          <h2 className="h2">
            {section.workerName}
            {section.label && <span className="muted"> · {section.label}</span>}
          </h2>
          <ul className="tasks">
            {section.tasks.map((t, j) => {
              const s = stateOf(t);
              const key = t.locationText ? normalizeKey(t.locationText) : '';
              const group = t.match === 'unknown' ? groupByKey.get(key) : undefined;
              const showResolver = group && !shownFor.has(key);
              if (group) shownFor.add(key);
              return (
                <TaskLine
                  key={j}
                  state={s.state}
                  placeName={s.name}
                  region={s.region}
                  locationText={t.locationText}
                  description={t.description}
                  types={t.types}
                  windowStart={t.windowStart}
                  windowEnd={t.windowEnd}
                  flags={t.flags}
                  address={t.address}
                >
                  {showResolver && group && (
                    <PlaceResolver
                      group={group}
                      value={resolutions.get(group.key)}
                      allowSkip
                      onChange={(r) => setResolution(group.key, r)}
                    />
                  )}
                </TaskLine>
              );
            })}
            {section.tasks.length === 0 && <li className="muted small">אין משימות</li>}
          </ul>
        </section>
      ))}

      {(parsed.vehicle.length > 0 || parsed.notes.length > 0) && (
        <section className="card stack-sm">
          {parsed.vehicle.length > 0 && (
            <>
              <h2 className="h2">סידור רכב</h2>
              <ul className="plain">
                {parsed.vehicle.map((v, i) => (
                  <li key={i}>{v.text}</li>
                ))}
              </ul>
            </>
          )}
          {parsed.notes.length > 0 && (
            <>
              <h2 className="h2">הערות</h2>
              <ul className="plain">
                {parsed.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <div className="footer-bar">
        {error && <p className="error">השמירה נכשלה: {error}</p>}
        <button className="btn btn-primary btn-block" disabled={saving || !date || parsed.sections.length === 0} onClick={() => void save()}>
          {saving ? 'שומר…' : 'שמירת הסידור'}
        </button>
      </div>
    </div>
  );
}

function regionOf(r: Region | undefined): Region {
  return r ?? 'unknown';
}

/** The task's place, counting an unknown name the planner has just matched to a known place. */
function placeIdOf(t: ParsedTask, resolutions: Map<string, Resolution>): string | null {
  if (t.placeId) return t.placeId;
  if (t.match !== 'unknown' || !t.locationText) return null;
  const r = resolutions.get(normalizeKey(t.locationText));
  return r?.type === 'existing' ? r.placeId : null;
}
