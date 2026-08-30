"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronDown, CircleDot, Clock3, LockKeyhole, Radar, ShieldCheck, Sparkles } from "lucide-react";
import type { Effort, RunSummary, UserMode } from "@cronoblox/contracts";

const audits = [
  { icon: CircleDot, label: "Roblox data", detail: "Identity, live engagement, votes & activity", required: true },
  { icon: Radar, label: "Market signal", detail: "Creator coverage, themes & momentum", required: false },
  { icon: Sparkles, label: "Comparables", detail: "Explained peers, never invented similarity", required: false },
  { icon: ShieldCheck, label: "Critic", detail: "Challenges the thesis before you see it", required: false },
];

const efforts: Array<{ id: Effort; label: string; detail: string }> = [
  { id: "low", label: "LOW", detail: "Fewest searches, no critic revision" },
  { id: "medium", label: "MEDIUM", detail: "Balanced research and one revision" },
  { id: "high", label: "HIGH", detail: "Widest research, two revisions" },
];

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<UserMode>("developer");
  const [profile, setProfile] = useState("hackathon-full");
  const [effort, setEffort] = useState<Effort>("medium");
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RunSummary[]>([]);

  useEffect(() => { fetch("/api/runs").then((r) => r.ok ? r.json() : { runs: [] }).then((data) => setRecent(data.runs ?? [])).catch(() => undefined); }, []);
  const selectedModules = profile === "baseline" ? ["roblox-data"] : profile === "research-no-critic" ? ["roblox-data", "market-intelligence"] : ["roblox-data", "market-intelligence", "critic"];

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError(null);
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game_url: url, user_mode: mode, profile_id: profile, effort, optional_modules: selectedModules.filter((item) => item !== "roblox-data") }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start the investigation");
      router.push(`/runs/${body.run_id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the investigation"); setSubmitting(false); }
  }

  return (
    <main className="app-shell">
      <SiteHeader />
      <section className="hero-grid">
        <div className="hero-copy">
          <h1>Find the signal<br />before the <em>hype.</em></h1>
          <p className="lede">Cronoblox investigates one Roblox game, tests the breakout thesis, and shows every piece of evidence behind the call.</p>
          <div className="promise-row"><span><CheckCircle2 /> No fake probability</span><span><CheckCircle2 /> Every claim sourced</span></div>
        </div>

        <form className="launch-card" onSubmit={submit}>
          <div className="card-kicker"><span>NEW INVESTIGATION</span><b>01</b></div>
          <label htmlFor="game-url">ROBLOX GAME URL OR PLACE ID</label>
          <div className="url-field"><span>rbx://</span><input id="game-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="roblox.com/games/123456789/..." required /></div>
          <div className="choice-row" role="radiogroup" aria-label="Report emphasis">
            <button className={`choice ${mode === "developer" ? "active" : ""}`} type="button" role="radio" aria-checked={mode === "developer"} onClick={() => setMode("developer")}><span>DEVELOPER</span><small>Product signals & next moves</small></button>
            <button className={`choice ${mode === "investor" ? "active" : ""}`} type="button" role="radio" aria-checked={mode === "investor"} onClick={() => setMode("investor")}><span>INVESTOR / PUBLISHER</span><small>Momentum, durability & risk</small></button>
          </div>
          <label htmlFor="profile">ANALYSIS PROFILE</label>
          <select id="profile" className="profile-select" value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="hackathon-full">Hackathon full — research + critic</option>
            <option value="research-no-critic">Research, no critic</option>
            <option value="baseline">Baseline — direct assessment only</option>
            <option value="demo-replay">Demo replay — cached fixture</option>
          </select>
          <label htmlFor="effort">RESEARCH EFFORT</label>
          <div className="choice-row effort-row" role="radiogroup" aria-label="Research effort" id="effort">
            {efforts.map((option) => <button key={option.id} className={`choice ${effort === option.id ? "active" : ""}`} type="button" role="radio" aria-checked={effort === option.id} onClick={() => setEffort(option.id)}><span>{option.label}</span><small>{option.detail}</small></button>)}
          </div>
          <button className="advanced-toggle" type="button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>ADVANCED MODULES <ChevronDown className={advanced ? "rotated" : ""} /></button>
          {advanced && <div className="module-list">{audits.map((audit) => <div key={audit.label}><span>{audit.required ? <LockKeyhole /> : <span className={`toggle-dot ${selectedModules.length > 1 ? "on" : ""}`} />} {audit.label}</span><small>{audit.required ? "Required" : selectedModules.length > 1 ? "Profile controlled" : "Disabled"}</small></div>)}</div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="launch" type="submit" disabled={submitting}>{submitting ? "QUEUING AUDIT…" : "RUN THE AUDIT"} <ArrowRight /></button>
          <p className="fine-print">Uses public game-level data only. No player tracking.</p>
        </form>
      </section>

      <section className="audit-strip" aria-label="Investigation modules">
        <div className="strip-heading"><span>THE INVESTIGATION</span><small>Every audit is visible. Every conclusion is challengeable.</small></div>
        <div className="audit-grid">{audits.map(({ icon: Icon, label, detail }) => <article key={label} className="audit-item"><Icon /><h2>{label}</h2><p>{detail}</p></article>)}</div>
      </section>

      <section className="recent-section">
        <div className="strip-heading"><span>RECENT INVESTIGATIONS</span><small>Immutable profiles make every run reproducible.</small></div>
        {recent.length === 0 ? <div className="empty-runs"><Clock3 /><p>No investigations yet. Run the cached demo to see the complete flow without API keys.</p></div> : <div className="recent-list">{recent.map((run) => <a href={`/runs/${run.id}`} key={run.id}><span className={`run-state ${run.state.toLowerCase()}`}>{run.state}</span><strong>{run.game_name ?? run.input.game_url}</strong><small>{run.profile_snapshot.label} · {new Date(run.created_at).toLocaleString()}</small><ArrowRight /></a>)}</div>}
      </section>
    </main>
  );
}

function SiteHeader() {
  return <header className="topbar"><a className="brand" href="/" aria-label="Cronoblox home"><span className="brand-mark">C</span><span>CRONOBLOX</span></a><div className="status-chip"><span /> SYSTEM READY</div></header>;
}
