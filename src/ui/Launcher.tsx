import { useApp } from '../appContext';
import { ROUTE_HOME } from '../appContext';

/** The first screen for whoever has both apps: one square per app. */
export function Launcher() {
  const { profile } = useApp();
  return (
    <div className="stack-lg">
      <section>
        <h1 className="h1">שלום {profile.display_name}</h1>
        <p className="muted">לאן נכנסים?</p>
      </section>
      <div className="launcher">
        <a className="launcher-tile" href={`#${ROUTE_HOME}`}>
          <span className="launcher-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="19" r="2" />
              <circle cx="18" cy="5" r="2" />
              <path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7" />
            </svg>
          </span>
          <span className="launcher-name">Trimaco Route</span>
          <span className="launcher-text">הסידור היומי של הנהגים, והצעות לחסוך נסיעות</span>
        </a>
        <a className="launcher-tile" href="#/imports">
          <span className="launcher-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
            </svg>
          </span>
          <span className="launcher-name">Trimaco Imports</span>
          <span className="launcher-text">איזה מוביל לבחור למשלוח אווירי, וכמה הוא צפוי לעלות</span>
        </a>
      </div>
    </div>
  );
}
