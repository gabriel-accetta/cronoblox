"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Circle, Clock3, ExternalLink, LoaderCircle, ShieldAlert, X } from "lucide-react";
import type { BreakoutPotential, Evidence, Report, RunEvent } from "@cronoblox/contracts";

type RunDetail = { run: import("@cronoblox/contracts").RunSummary; events: RunEvent[]; report: Report | null };
const flow = ["COLLECT_CORE", "PLAN", "EXECUTE", "RECORD", "SYNTHESIZE", "CRITIQUE", "ROUTE", "FINALIZE"];
const stateCopy: Record<string, string> = { COLLECT_CORE: "Identity + platform signals", PLAN: "Orchestrator plans its research", EXECUTE: "Orchestrator delegates to sub-agents", RECORD: "Evidence validation", SYNTHESIZE: "Thesis formed", CRITIQUE: "Falsification review", ROUTE: "Objection resolution", FINALIZE: "Structured report" };

/** Drives the semantic colour scale in CSS: red at LOW through green at VERY HIGH. */
const toneOf = (potential: BreakoutPotential) => potential.toLowerCase().replace(" ", "-");

async function fetchRun(id: string): Promise<RunDetail> {
  const response = await fetch(`/api/runs/${id}`); if (!response.ok) throw new Error("Could not load this investigation"); return response.json();
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useQuery({ queryKey: ["run", id], queryFn: () => fetchRun(id), refetchInterval: (result) => { const state = result.state.data?.run.state; return state && !["COMPLETED", "FAILED", "CANCELLED"].includes(state) ? 1000 : false; } });
  const data = query.data;
  if (query.isLoading) return <LoadingPage />;
  if (query.isError || !data) return <main className="run-shell"><RunHeader /><div className="run-error"><AlertTriangle /><h1>Investigation unavailable</h1><p>{query.error?.message ?? "Run not found"}</p><a href="/">Return home</a></div></main>;
  return <main className="run-shell"><RunHeader />{data.report ? <ReportView report={data.report} /> : <ProgressView detail={data} onRefresh={() => query.refetch()} />}</main>;
}

function RunHeader() { return <header className="topbar run-topbar"><a className="brand" href="/" aria-label="Cronoblox home"><img className="brand-logo" src="/cronoblox-logo.png" alt="Cronoblox" width={160} height={22} /></a><a className="back-link" href="/"><ArrowLeft /> <span>NEW AUDIT</span></a></header>; }
function LoadingPage() { return <main className="run-shell"><RunHeader /><div className="run-loading"><LoaderCircle /><p>Loading investigation…</p></div></main>; }

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useElapsedTime(createdAt: string, running: boolean) {
  const startedAt = new Date(createdAt).getTime();
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));

  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Date.now() - startedAt));
    update();
    if (!running) return;
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [createdAt, running, startedAt]);

  return elapsed;
}

/* ------------------------------------------------------------------ progress */

/**
 * `agent.tool_call` style event types carry the acting agent as their first segment. Tool events
 * also carry the tool name and a short argument preview, so ten calls to the same tool stay
 * distinguishable without opening anything.
 */
function actorOf(event: RunEvent): { agent: string | null; action: string; detail: string | null } {
  const tool = typeof event.data.tool === "string" ? event.data.tool : null;
  const detail = typeof event.data.detail === "string" && event.data.detail ? event.data.detail : null;
  const [head = "", ...rest] = event.event_type.split(".");
  if (head === "state" || head === "run" || rest.length === 0) return { agent: null, action: event.state.replaceAll("_", " "), detail: null };
  return { agent: head.replaceAll("-", " "), action: tool ?? rest.join(" ").replaceAll("_", " "), detail };
}

function ProgressView({ detail, onRefresh }: { detail: RunDetail; onRefresh: () => void }) {
  const stateIndex = flow.indexOf(detail.run.state);
  const settled = ["COMPLETED", "FAILED", "CANCELLED"].includes(detail.run.state);
  const elapsed = useElapsedTime(detail.run.created_at, !settled);
  // Newest first: during a live agent loop the reader should never have to chase the bottom of a growing list.
  const events = useMemo(() => [...detail.events].sort((a, b) => b.sequence - a.sequence), [detail.events]);
  async function action(kind: "cancel" | "retry") { await fetch(`/api/runs/${detail.run.id}/${kind}`, { method: "POST" }); onRefresh(); }

  return <div className="progress-page">
    {detail.run.profile_snapshot.fixture_mode && <div className="fixture-banner"><AlertTriangle /> CACHED FIXTURE RUN — NOT LIVE PROVIDER DATA</div>}
    <div className="progress-heading">
      <div>
        <h1>{detail.run.game_name ?? "Resolving Roblox game…"}</h1>
        <p className="meta-row">
          <span>{detail.run.input.game_url}</span>
          <span className="dot" />
          <span>{detail.run.profile_snapshot.label}</span>
        </p>
      </div>
      <div className="progress-status">
        <span className="run-timer" aria-label={`Elapsed time ${formatElapsed(elapsed)}`}><Clock3 /> {formatElapsed(elapsed)}</span>
      </div>
    </div>

    <section className="pipeline-card"><div className="pipeline-line" />{flow.map((state, index) => {
      const done = stateIndex > index || detail.run.state === "COMPLETED";
      const active = detail.run.state === state;
      return <div key={state} className={`pipeline-step ${done ? "done" : ""} ${active ? "active" : ""}`}><span>{done ? <Check /> : active ? <LoaderCircle className="spin" /> : <Circle />}</span><div><b>{state.replaceAll("_", " ")}</b><small>{stateCopy[state]}</small></div></div>;
    })}</section>

    <div className="progress-columns">
      <section className="event-log">
        <div className="section-title"><span>VISIBLE TRAJECTORY</span><small>{settled ? `${events.length} steps` : "Newest first · no private chain-of-thought"}</small></div>
        <div className="event-stream">
          {events.length === 0 && <p className="event-empty">Waiting for the first step…</p>}
          {events.map((event, index) => {
            const { agent, action: label, detail } = actorOf(event);
            return <article key={event.id} className={`${event.level} ${index === 0 && !settled ? "latest" : ""}`}>
              <time>{new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
              <div>
                <div className="event-actor"><strong>{agent ?? label}</strong>{agent && <em>{label}</em>}</div>
                <p>{detail ?? event.message}</p>
              </div>
            </article>;
          })}
        </div>
      </section>
      <aside className="run-aside">
        <div><span>PROFILE</span><strong>{detail.run.profile_snapshot.label}</strong><p>{detail.run.profile_snapshot.description}</p></div>
        <div><span>MODE</span><strong>{detail.run.input.user_mode === "developer" ? "Developer" : "Investor / publisher"}</strong></div>
        <div><span>EFFORT</span><strong>{(detail.run.profile_snapshot.effort ?? "medium").toUpperCase()}</strong><p>{detail.run.profile_snapshot.limits.max_search_results} results per search</p></div>
        <div><span>BUDGET</span><strong>{detail.run.profile_snapshot.limits.max_external_calls} calls · ${detail.run.profile_snapshot.limits.max_cost_usd.toFixed(2)} cap</strong><p>{detail.run.profile_snapshot.limits.max_critic_cycles} critic revision cycles. A turn is one model request; tool calls use the separate call budget.</p></div>
      </aside>
    </div>

    {detail.run.state === "FAILED" ? <div className="failure-box"><ShieldAlert /><div><strong>The run stopped safely</strong><p>{detail.run.error}</p></div><button onClick={() => action("retry")}>RETRY RUN</button></div>
      : detail.run.state === "CANCELLED" ? <div className="failure-box"><div><strong>Investigation cancelled</strong><p>Captured evidence remains available in the database.</p></div><button onClick={() => action("retry")}>RETRY RUN</button></div>
      : <button className="cancel-button" onClick={() => action("cancel")}>CANCEL INVESTIGATION</button>}
  </div>;
}

/* -------------------------------------------------------------------- report */

function ReportView({ report }: { report: Report }) {
  const [drawer, setDrawer] = useState<{ ids: string[]; label: string; summary?: string } | null>(null);
  const { game, verdict } = report;
  const open = (label: string, summary?: string) => (ids: string[]) => setDrawer({ ids, label, summary });
  const heldRating = report.initial_verdict.breakout_potential === verdict.breakout_potential;

  return <>
    {report.is_fixture && <div className="fixture-banner"><AlertTriangle /> CACHED FIXTURE REPORT — NOT A LIVE AUDIT</div>}
    <div className="report-page">
      <section className="report-hero" data-potential={toneOf(verdict.breakout_potential)}>
        {game.icon_url ? <img className="game-art" src={game.icon_url} alt={`${game.name} icon`} width={116} height={116} /> : <div className="game-art monogram" aria-hidden>{game.name.slice(0, 1)}</div>}
        <div className="game-identity">
          <h1>{game.name}</h1>
          <p className="meta-row">
            <a href={game.url} target="_blank" rel="noreferrer">Open on Roblox <ExternalLink /></a>
            <span className="dot" />
            {game.creator_url ? <a href={game.creator_url} target="_blank" rel="noreferrer">{game.creator} <ExternalLink /></a> : <span>{game.creator}</span>}
            <span className="dot" />
            <span>Observed {new Date(game.observed_at).toLocaleString()}</span>
          </p>
        </div>
        <div className="verdict-panel">
          <span>BREAKOUT POTENTIAL</span>
          <strong>{verdict.breakout_potential}</strong>
          <p>{verdict.verdict_line}</p>
        </div>
      </section>

      {game.thumbnails.length > 0 && <div className="media-strip">{game.thumbnails.map((url, index) => <img key={url} src={url} alt={`${game.name} screenshot ${index + 1}`} loading="lazy" />)}</div>}

      <section className="panel">
        <div className="section-title"><span>AUDIT COVERAGE</span><small>Open any audit to inspect its evidence</small></div>
        <div className="audit-card-grid">{report.audit_cards.map((card) => <button key={card.module_id} onClick={() => open(card.label, card.summary)(card.evidence_ids)}>
          <div className="audit-card-head"><strong>{card.label}</strong><span className={`module-status ${card.status}`}>{card.status}</span></div>
          <p>{card.summary}</p>
          <small>{card.evidence_ids.length} evidence records <ArrowRight /></small>
        </button>)}</div>
      </section>

      <section className="thesis-grid">
        <ClaimPanel title="WHY IT MAY BREAK OUT" accent="positive" claims={report.supporting_claims} onEvidence={open("Supporting claim")} />
        <ClaimPanel title="WHY IT MAY NOT" accent="negative" claims={report.risk_claims} onEvidence={open("Risk claim")} />
      </section>

      <section className="panel">
        <div className="section-title"><span>CRITIC REVISION</span><small>{heldRating ? "Rating survived verification" : "Rating lowered after verification"}</small></div>
        {heldRating
          ? <div className="revision-held" data-potential={toneOf(verdict.breakout_potential)}><span>HELD AT</span><strong>{verdict.breakout_potential}</strong></div>
          : <div className="revision-row">
              <div data-potential={toneOf(report.initial_verdict.breakout_potential)}><span>INITIAL</span><strong>{report.initial_verdict.breakout_potential}</strong></div>
              <ArrowRight />
              <div data-potential={toneOf(verdict.breakout_potential)}><span>FINAL</span><strong>{verdict.breakout_potential}</strong></div>
            </div>}
        <p className="critic-summary">{report.critic.summary}</p>
        {report.critic.objections.map((item) => <details className="objection" key={item.id}><summary><span className={`severity ${item.severity}`}>{item.severity}</span>{item.summary}<ChevronDown /></summary><p><b>Resolution:</b> {item.resolution_request}</p></details>)}
      </section>

      <section className="action-card">
        <div><h2>RECOMMENDED NEXT ACTION</h2><p>{report.next_action}</p></div>
        <div><h2>WHAT TO MONITOR</h2><ul>{report.monitor.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </section>

      <section className="limitations">
        <div className="section-title"><span>LIMITATIONS &amp; RUN DETAILS</span><small>{(report.runtime_ms / 1000).toFixed(1)}s · approximately ${report.approximate_cost_usd.toFixed(4)}</small></div>
        <ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
    {drawer && <EvidenceDrawer runId={report.run_id} ids={drawer.ids} label={drawer.label} summary={drawer.summary} onClose={() => setDrawer(null)} />}
  </>;
}

function ClaimPanel({ title, accent, claims, onEvidence }: { title: string; accent: string; claims: Report["supporting_claims"]; onEvidence: (ids: string[]) => void }) {
  return <section className={`claim-panel ${accent}`}>
    <div className="section-title"><span>{title}</span><small>{claims.length} grounded {claims.length === 1 ? "claim" : "claims"}</small></div>
    {claims.length === 0 && <p className="claim-empty">Nothing survived verification on this side of the thesis.</p>}
    {claims.map((claim) => <article key={claim.id}><p>{claim.text}</p><button onClick={() => onEvidence(claim.evidence_ids)}>{claim.evidence_ids.length} {claim.evidence_ids.length === 1 ? "SOURCE" : "SOURCES"} <ArrowRight /></button></article>)}
  </section>;
}

/* ------------------------------------------------------------------ evidence */

const STRENGTH_RANK = { high: 3, medium: 2, low: 1 } as const;
const KIND_RANK = { fact: 3, inference: 2, recommendation: 1 } as const;
const RELATION_RANK = { contradicts: 3, supports: 3, contextualizes: 2, unresolved: 1 } as const;

/** Most load-bearing evidence first: how strongly it holds, then how directly it bears on the thesis. */
function evidenceWeight(item: Evidence) {
  return STRENGTH_RANK[item.support_strength] * 100 + RELATION_RANK[item.relationship] * 10 + KIND_RANK[item.kind];
}

/**
 * YouTube evidence all lands at the same weight (fact / medium / contextualizes), so view count is
 * what separates it: the video the most people actually watched is the stronger coverage signal.
 * Non-video records return -1 and keep their existing relative order.
 */
function evidenceViews(item: Evidence) {
  if (!item.source.type.startsWith("youtube")) return -1;
  const value = item.observation?.value;
  const views = typeof value === "object" && value !== null ? (value as { views?: unknown }).views : null;
  return typeof views === "number" ? views : -1;
}

function EvidenceDrawer({ runId, ids, label, summary, onClose }: { runId: string; ids: string[]; label: string; summary?: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["evidence", runId], queryFn: async () => { const response = await fetch(`/api/runs/${runId}/evidence`); return (await response.json()).evidence as Evidence[]; } });
  const items = useMemo(() => (query.data ?? []).filter((item) => ids.includes(item.id)).sort((a, b) => evidenceWeight(b) - evidenceWeight(a) || evidenceViews(b) - evidenceViews(a)), [query.data, ids]);

  return <div className="drawer-backdrop" onClick={onClose}>
    <aside className="evidence-drawer" onClick={(e) => e.stopPropagation()} aria-label="Evidence details">
      <header>
        <div><span>EVIDENCE WORKSPACE</span><small>{label} · {items.length} records, strongest first</small></div>
        <button onClick={onClose} aria-label="Close evidence drawer"><X /></button>
      </header>
      {summary && <p className="drawer-summary">{briefSummary(summary)}</p>}
      {query.isLoading ? <div className="drawer-loading"><LoaderCircle className="spin" /></div>
        : items.length === 0 ? <div className="drawer-empty">No evidence records were linked here.</div>
        : items.map((item, index) => <article key={item.id}>
          <div className="evidence-rank">
            <b>{String(index + 1).padStart(2, "0")}</b>
            <div className="evidence-tags">
              <span className={item.kind}>{item.kind}</span>
              <span className={item.support_strength === "high" ? "strong" : ""}>{item.support_strength} support</span>
              <span className={item.relationship === "contradicts" ? "contradicts" : ""}>{item.relationship}</span>
            </div>
          </div>
          <h3>{item.claim}</h3>
          <dl>
            <div><dt>Observed</dt><dd>{new Date(item.source.retrieved_at).toLocaleString()}</dd></div>
            <div><dt>Source</dt><dd>{item.source.type}</dd></div>
            <div><dt>Evidence ID</dt><dd>{item.id}</dd></div>
          </dl>
          {item.source.url && <a href={item.source.url} target="_blank" rel="noreferrer">OPEN SOURCE <ExternalLink /></a>}
          {item.notes && <p className="evidence-note">{item.notes}</p>}
        </article>)}
    </aside>
  </div>;
}

function briefSummary(summary: string) {
  const normalized = summary.replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/[^.!?]+[.!?]+(?:\s|$)?/g) ?? [];
  const preview = (sentences.slice(0, 2).join(" ").trim() || normalized);
  if (preview.length <= 280) return preview;
  const shortened = preview.slice(0, 280).replace(/\s+\S*$/, "");
  return `${shortened}…`;
}
