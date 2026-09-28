import { useState, type FormEvent } from 'react';
import { store } from '../lib/store';

/** First visit on a device: the person types their name; an admin then approves the device. */
export function Login() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await store().enter(name);
    if (err) {
      setError(err);
      setBusy(false);
    }
    // on success the app reloads itself through onAuthChange
  }

  return (
    <div className="centered">
      <form className="card narrow stack" onSubmit={submit}>
        <div className="login-brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={44} height={44} />
          <div>
            <h1 className="h1">Trimaco Route</h1>
            <p className="muted">סידור עבודה ללוגיסטיקה</p>
          </div>
        </div>
        <label className="field">
          <span>מה השם שלך?</span>
          <input type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="muted small">אין סיסמה. כותבים את השם פעם אחת בכל טלפון או מחשב, וזהו.</p>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          {busy ? 'רגע…' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
