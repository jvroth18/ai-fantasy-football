import { ArrowDown, ArrowRight, ArrowUp, Download, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import './PlayerRankings.css';

type SeasonStats = {
  season: number;
  games: number;
  fantasyPointsPpr: number;
  targets: number;
  carries: number;
};

type PlayerReview = {
  playerId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  overallRank: number;
  positionRank: number;
  score: number;
  performanceScore: number;
  opportunityScore: number;
  momentumScore: number;
  buzzScore: number;
  confidence: number;
  trend: 'rising' | 'steady' | 'falling';
  summary: string;
  strengths: string[];
  risks: string[];
  seasons: SeasonStats[];
  buzz: { adds24h: number; drops24h: number; netAdds24h: number; newsMentions30d: number };
  sources: Array<{ label: string; url: string; observedAt: string }>;
  generatedAt: string;
};

const positions = ['', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];

export function PlayerRankings() {
  const [reviews, setReviews] = useState<PlayerReview[]>([]);
  const [position, setPosition] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PlayerReview | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({ limit: '300' });
    if (position) parameters.set('position', position);
    if (search.trim()) parameters.set('search', search.trim());
    const timer = window.setTimeout(
      () => {
        void fetch(`/api/players?${parameters}`, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error(`Player rankings unavailable (${response.status})`);
            return (await response.json()) as { reviews: PlayerReview[] };
          })
          .then((payload) => {
            setReviews(payload.reviews);
            setStatus(payload.reviews.length ? 'ready' : 'empty');
          })
          .catch((error: unknown) => {
            if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error');
          });
      },
      search ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [position, search]);

  return (
    <section className="player-intelligence" aria-labelledby="player-rankings-title">
      <div className="ranking-heading">
        <div>
          <p className="kicker">INDEPENDENT PLAYER INTELLIGENCE</p>
          <h2 id="player-rankings-title">Player reviews and rankings</h2>
          <p>
            Historical production leads the score. Workload, market momentum, and attributed news
            attention add context—not hype.
          </p>
        </div>
        <div className="ranking-filters">
          <a className="export-button" href="/api/player-intelligence/export?format=jsonl" download>
            <Download size={15} /> AI handoff
          </a>
          <label>
            <Search size={15} />
            <span className="sr-only">Search players</span>
            <input
              value={search}
              placeholder="Search player"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            aria-label="Filter by position"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
          >
            {positions.map((value) => (
              <option key={value || 'all'} value={value}>
                {value || 'All positions'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {status === 'loading' ? <p className="ranking-state">Loading player intelligence…</p> : null}
      {status === 'empty' ? (
        <p className="ranking-state">Run the public data refresh to compile player reviews.</p>
      ) : null}
      {status === 'error' ? (
        <p className="ranking-state">Start the local daemon to consult rankings.</p>
      ) : null}
      {status === 'ready' ? (
        <div className="ranking-table-wrap">
          <table className="ranking-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Score</th>
                <th>2025 PPR/G</th>
                <th>Market</th>
                <th>Confidence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reviews.map((review) => {
                const lastSeason = review.seasons[0];
                return (
                  <tr key={review.playerId}>
                    <td>
                      <b>{review.overallRank}</b>
                      <small>
                        {review.position}
                        {review.positionRank}
                      </small>
                    </td>
                    <td>
                      <b>{review.fullName}</b>
                      <small>{review.nflTeam ?? 'FA'}</small>
                    </td>
                    <td>
                      <strong>{review.score.toFixed(1)}</strong>
                    </td>
                    <td>
                      {lastSeason?.games
                        ? (lastSeason.fantasyPointsPpr / lastSeason.games).toFixed(1)
                        : '—'}
                    </td>
                    <td className={`trend ${review.trend}`}>
                      {review.trend === 'rising' ? (
                        <ArrowUp size={14} />
                      ) : review.trend === 'falling' ? (
                        <ArrowDown size={14} />
                      ) : (
                        '—'
                      )}{' '}
                      {review.buzz.netAdds24h > 0 ? '+' : ''}
                      {review.buzz.netAdds24h}
                    </td>
                    <td>{Math.round(review.confidence)}%</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelected(review)}
                        aria-label={`Review ${review.fullName}`}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected ? (
        <div className="review-backdrop" onMouseDown={() => setSelected(null)}>
          <article className="review-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <button
              className="review-close"
              type="button"
              aria-label="Close player review"
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <p className="kicker">
              #{selected.overallRank} OVERALL · {selected.position}
              {selected.positionRank}
            </p>
            <h2>{selected.fullName}</h2>
            <p>{selected.summary}</p>
            <div className="score-grid">
              <span>
                <b>{selected.performanceScore}</b>Production
              </span>
              <span>
                <b>{selected.opportunityScore}</b>Opportunity
              </span>
              <span>
                <b>{selected.momentumScore}</b>Momentum
              </span>
              <span>
                <b>{selected.buzzScore}</b>Buzz
              </span>
            </div>
            <h3>Case for</h3>
            <ul>
              {selected.strengths.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3>Risks</h3>
            <ul>
              {selected.risks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3>Season history</h3>
            <div className="season-history">
              {selected.seasons.map((season) => (
                <span key={season.season}>
                  <b>{season.season}</b>
                  {season.games} games · {season.fantasyPointsPpr.toFixed(1)} PPR
                </span>
              ))}
            </div>
            <p className="source-list">
              Sources:{' '}
              {selected.sources.map((source, index) => (
                <span key={source.url}>
                  {index ? ' · ' : ''}
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.label}
                  </a>
                </span>
              ))}
            </p>
          </article>
        </div>
      ) : null}
    </section>
  );
}
