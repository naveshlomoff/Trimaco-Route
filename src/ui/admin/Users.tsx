import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../appContext';
import { store } from '../../lib/store';
import { deviceCode, type Profile, type Role } from '../../lib/types';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'מנהל',
  planner: 'מתכנן',
  pending: 'ממתין',
  blocked: 'חסום',
};

/** Every phone or computer that entered the app; admins can rename, promote or block. */
export function Users() {
  const { profile: me } = useApp();
  const [list, setList] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await store().listProfiles());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(id: string, patch: Partial<Pick<Profile, 'role' | 'display_name'>>) {
    setError(null);
    try {
      await store().updateProfile(id, patch);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div>
          <h1 className="h1">משתמשים</h1>
          <p className="muted small">
            כל טלפון או מחשב שנכנס לאפליקציה. אין סיסמאות: מי שפותח את הקישור וכותב שם נכנס מיד. מכשיר לא מוכר אפשר
            לחסום, וכך הוא לא יראה כלום.
          </p>
        </div>
        {error && <p className="error">{error}</p>}
        {list === null && <p className="muted">טוען…</p>}
        {list && (
          <ul className="list flush">
            {list.map((p) => (
              <li key={p.id} className="user-row">
                <div className="grow">
                  <div>
                    <strong>{p.display_name}</strong>
                    {p.id === me.id && <span className="muted small"> (המכשיר הזה)</span>}
                  </div>
                  <div className="muted small">
                    קוד <span dir="ltr">{deviceCode(p.id)}</span>
                    {p.created_at && ` · נכנס לראשונה ${new Date(p.created_at).toLocaleDateString('he-IL')}`}
                  </div>
                </div>
                <div className="row wrap">
                  <select
                    value={p.role}
                    disabled={p.id === me.id}
                    onChange={(e) => void update(p.id, { role: e.target.value as Role })}
                  >
                    {(['planner', 'admin', 'blocked'] as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                    {p.role === 'pending' && <option value="pending">{ROLE_LABELS.pending}</option>}
                  </select>
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => {
                      const name = window.prompt('שם להצגה', p.display_name);
                      if (name && name.trim()) void update(p.id, { display_name: name.trim() });
                    }}
                  >
                    שינוי שם
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
