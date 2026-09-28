import { useState, type FormEvent } from 'react';
import { store } from '../lib/store';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await store().signIn(username, password);
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
          <span>שם משתמש</span>
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            dir="ltr"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>סיסמה</span>
          <input
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'מתחבר…' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
