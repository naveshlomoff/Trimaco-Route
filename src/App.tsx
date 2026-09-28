import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppContext, useApp } from './appContext';
import { isConfigured } from './config';
import { store } from './lib/store';
import { deviceCode, type Place, type Profile, type Worker } from './lib/types';
import { Dashboard } from './ui/admin/Dashboard';
import { ImportChat } from './ui/admin/ImportChat';
import { Places } from './ui/admin/Places';
import { Users } from './ui/admin/Users';
import { DayView } from './ui/DayView';
import { Home } from './ui/Home';
import { Login } from './ui/Login';
import { Review } from './ui/Review';

function currentPath(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

function useHashPath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

export function App({ demo }: { demo: boolean }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const path = useHashPath();

  const load = useCallback(async () => {
    try {
      const p = await store().getProfile();
      if (p && (p.role === 'admin' || p.role === 'planner')) {
        const [w, pl] = await Promise.all([store().loadWorkers(), store().loadPlaces()]);
        setWorkers(w);
        setPlaces(pl);
      }
      setProfile(p);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    return store().onAuthChange(() => void load());
  }, [load]);

  const reloadPlaces = useCallback(async () => {
    setPlaces(await store().loadPlaces());
  }, []);

  if (!isConfigured && !demo) {
    return <CenteredMessage title="Trimaco Route" text="האפליקציה עוד לא מחוברת למסד הנתונים." />;
  }
  if (error) {
    return (
      <CenteredMessage title="משהו השתבש" text={`אין חיבור לשרת כרגע. ${error}`}>
        <button className="btn btn-primary" onClick={() => void load()}>
          לנסות שוב
        </button>
      </CenteredMessage>
    );
  }
  if (profile === undefined) return <CenteredMessage title="Trimaco Route" text="טוען…" />;
  if (profile === null) return <Login />;
  if (profile.role === 'blocked' || profile.role === 'pending') {
    return (
      <CenteredMessage title="אין גישה" text="למכשיר הזה אין כרגע גישה לאפליקציה.">
        <p className="muted small">
          קוד המכשיר: <span dir="ltr">{deviceCode(profile.id)}</span>
        </p>
      </CenteredMessage>
    );
  }

  return (
    <AppContext.Provider value={{ profile, workers, places, reloadPlaces, demo }}>
      <Shell path={path} />
    </AppContext.Provider>
  );
}

function Shell({ path }: { path: string }) {
  const { profile, demo } = useApp();
  const isAdmin = profile.role === 'admin';
  const tabs = [
    { path: '/', label: 'סידור יומי' },
    ...(isAdmin
      ? [
          { path: '/admin', label: 'לוח מנהל' },
          { path: '/admin/places', label: 'מקומות' },
          { path: '/admin/import', label: 'ייבוא' },
          { path: '/admin/users', label: 'משתמשים' },
        ]
      : []),
  ];
  const active = tabs.reduce((best, t) => (path.startsWith(t.path) && t.path.length > best.length ? t.path : best), '/');

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <a className="brand" href="#/">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
            <span>Trimaco Route</span>
            {demo && <span className="chip chip-warn">דמו</span>}
          </a>
          {/* No sign-out: without passwords, signing out would need a new approval. */}
          <div className="header-user">
            <span className="muted">{profile.display_name}</span>
          </div>
        </div>
        {tabs.length > 1 && (
          <nav className="tabs">
            {tabs.map((t) => (
              <a key={t.path} href={`#${t.path}`} className={t.path === active ? 'tab tab-active' : 'tab'}>
                {t.label}
              </a>
            ))}
          </nav>
        )}
      </header>
      <main className="container">{route(path, isAdmin)}</main>
    </>
  );
}

function route(path: string, isAdmin: boolean) {
  if (path === '/review') return <Review />;
  const day = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (day) return <DayView key={day[1]} date={day[1]} />;
  if (isAdmin && path === '/admin') return <Dashboard />;
  if (isAdmin && path === '/admin/places') return <Places />;
  if (isAdmin && path === '/admin/import') return <ImportChat />;
  if (isAdmin && path === '/admin/users') return <Users />;
  return <Home />;
}


function CenteredMessage({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="centered">
      <div className="card narrow stack">
        <h1 className="h1">{title}</h1>
        <p className="muted">{text}</p>
        {children}
      </div>
    </div>
  );
}
