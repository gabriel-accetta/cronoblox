"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, CircleDot, Clock3, LockKeyhole, Radar, ShieldCheck, Sparkles } from "lucide-react";
import type { Effort, RunSummary, UserMode } from "@cronoblox/contracts";
import { IntegrationCard } from "@/components/integration-card";

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
  const [profile, setProfile] = useState("full");
  const [effort, setEffort] = useState<Effort>("medium");
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RunSummary[]>([]);
  const [collapsedFormHeight, setCollapsedFormHeight] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => { fetch("/api/runs").then((r) => r.ok ? r.json() : { runs: [] }).then((data) => setRecent(data.runs ?? [])).catch(() => undefined); }, []);
  useEffect(() => {
    if (advanced || !formRef.current) return;
    const form = formRef.current;
    const measure = () => setCollapsedFormHeight(Math.ceil(form.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    return () => observer.disconnect();
  }, [advanced]);
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
      <section className={`hero-grid ${collapsedFormHeight ? "hero-grid-locked" : ""}`}>
        <div className="hero-copy-slot" style={collapsedFormHeight ? { minHeight: collapsedFormHeight } : undefined}>
          <div className="hero-copy">
            <h1>Find the signal<br />before the <em>hype.</em></h1>
            <p className="lede">Cronoblox investigates one Roblox game, tests the breakout thesis, and shows every piece of evidence behind the call.</p>
            <IntegrationCard gameUrl={url} />
          </div>
        </div>

        <form className="launch-card" ref={formRef} onSubmit={submit}>
          <div className="card-kicker"><span>NEW INVESTIGATION</span></div>
          <label htmlFor="game-url">ROBLOX GAME URL OR EXPERIENCE ID</label>
          <div className="url-field"><span>rbx://</span><input id="game-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="roblox.com/games/123456789/..." required /></div>
          <div className="choice-row" role="radiogroup" aria-label="Report emphasis">
            <button className={`choice ${mode === "developer" ? "active" : ""}`} type="button" role="radio" aria-checked={mode === "developer"} onClick={() => setMode("developer")}><span>DEVELOPER</span><small>Product signals & next moves</small></button>
            <button className={`choice ${mode === "investor" ? "active" : ""}`} type="button" role="radio" aria-checked={mode === "investor"} onClick={() => setMode("investor")}><span>INVESTOR / PUBLISHER</span><small>Momentum, durability & risk</small></button>
          </div>
          <label htmlFor="profile">ANALYSIS PROFILE</label>
          <select id="profile" className="profile-select" value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="full">Full — research + critic</option>
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
        <div className="strip-heading"><span>RECENT INVESTIGATIONS</span></div>
        {recent.length === 0 ? <div className="empty-runs"><Clock3 /><p>No investigations yet. Run the cached demo to see the complete flow without API keys.</p></div> : <div className="recent-list">{recent.map((run) => <a href={`/runs/${run.id}`} key={run.id}><span className={`run-state ${run.state.toLowerCase()}`}>{run.state}</span><strong>{run.game_name ?? run.input.game_url}</strong><small>{run.profile_snapshot.label} · {new Date(run.created_at).toLocaleString()}</small><ArrowRight /></a>)}</div>}
      </section>
    </main>
  );
}

function SiteHeader() {
  return <header className="topbar home-topbar"><a className="brand" href="/" aria-label="Cronoblox home"><img className="brand-logo" src="/cronoblox-logo.png" alt="Cronoblox" width={160} height={22} /></a><a className="github-link" href="https://github.com/gabriel-accetta/cronoblox" target="_blank" rel="noreferrer"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.73.5.5 5.74.5 12.02c0 5.1 3.29 9.42 7.86 10.95.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.26 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.53 11.53 0 0 0 23.5 12.02C23.5 5.74 18.27.5 12 .5Z" /></svg><span>gabriel-accetta/cronoblox</span></a></header>;
}
