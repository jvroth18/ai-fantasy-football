import { Activity, Bot, Database, ShieldCheck, Trophy } from 'lucide-react';

const capabilities = [
  {
    icon: Trophy,
    label: 'Draft war room',
    detail: 'Live tiers, scarcity, and roster construction',
  },
  {
    icon: Activity,
    label: 'Daily management',
    detail: 'Lineups, waivers, news, and contingencies',
  },
  { icon: Bot, label: 'Codex driven', detail: 'Structured analysis with auditable decisions' },
  {
    icon: ShieldCheck,
    label: 'Verified actions',
    detail: 'Read, act, read back—never submit blindly',
  },
];

export function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark">AI</div>
        <div>
          <p className="eyebrow">LOCAL FANTASY OPERATIONS</p>
          <h1>ai-fantasy-football</h1>
        </div>
        <div className="status">
          <span /> Baseline online
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">YOUR FRONT OFFICE, ALWAYS WORKING</p>
          <h2>Turn league rules and live football data into decisive action.</h2>
          <p>
            Manage every team independently with deterministic scoring, explainable projections,
            Codex intelligence, and guarded ESPN automation.
          </p>
          <div className="actions">
            <button type="button">Create your first team</button>
            <button className="secondary" type="button">
              Inspect data sources
            </button>
          </div>
        </div>
        <div className="signal-card">
          <div className="signal-title">
            <Database size={18} /> Data readiness
          </div>
          <div className="meter">
            <span />
          </div>
          <dl>
            <div>
              <dt>League rules</dt>
              <dd>Awaiting team</dd>
            </div>
            <div>
              <dt>Player universe</dt>
              <dd>Ready to seed</dd>
            </div>
            <div>
              <dt>Codex</dt>
              <dd>Local authentication</dd>
            </div>
            <div>
              <dt>ESPN</dt>
              <dd>Computer Use adapter</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="capability-grid" aria-label="Core capabilities">
        {capabilities.map(({ icon: Icon, label, detail }) => (
          <article key={label}>
            <Icon size={22} />
            <h3>{label}</h3>
            <p>{detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
