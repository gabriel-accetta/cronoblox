"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Circle, ExternalLink, LoaderCircle, ShieldAlert, X } from "lucide-react";
import type { Evidence, Report, RunDetailResponseSchema } from "@cronoblox/contracts";

type RunDetail = { run: import("@cronoblox/contracts").RunSummary; events: import("@cronoblox/contracts").RunEvent[]; report: Report | null };
const flow = ["COLLECT_CORE", "PLAN", "EXECUTE", "RECORD", "SYNTHESIZE", "CRITIQUE", "ROUTE", "FINALIZE"];

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

function RunHeader() { return <header className="topbar run-topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span>CRONOBLOX</span></a><a className="back-link" href="/"><ArrowLeft /> NEW AUDIT</a></header>; }
function LoadingPage() { return <main className="run-shell"><RunHeader /><div className="run-loading"><LoaderCircle /><p>Loading investigation…</p></div></main>; }

function ProgressView({ detail, onRefresh }: { detail: RunDetail; onRefresh: () => void }) {
  const stateIndex = flow.indexOf(detail.run.state);
  async function action(kind: "cancel" | "retry") { await fetch(`/api/runs/${detail.run.id}/${kind}`, { method: "POST" }); onRefresh(); }
  return <div className="progress-page">
    {detail.run.profile_snapshot.fixture_mode && <div className="fixture-banner"><AlertTriangle /> CACHED FIXTURE RUN — NOT LIVE PROVIDER DATA</div>}
    <div className="progress-heading"><div><span className="eyebrow">LIVE INVESTIGATION</span><h1>{detail.run.game_name ?? "Resolving Roblox game…"}</h1><p>{detail.run.input.game_url}</p></div><span className={`run-state big ${detail.run.state.toLowerCase()}`}>{detail.run.state.replaceAll("_", " ")}</span></div>
    <section className="pipeline-card"><div className="pipeline-line" />{flow.map((state, index) => { const done = stateIndex > index || detail.run.state === "COMPLETED"; const active = detail.run.state === state; return <div key={state} className={`pipeline-step ${done ? "done" : ""} ${active ? "active" : ""}`}><span>{done ? <Check /> : active ? <LoaderCircle className="spin" /> : <Circle />}</span><div><b>{state.replaceAll("_", " ")}</b><small>{stateCopy[state]}</small></div></div>; })}</section>
    <div className="progress-columns"><section className="event-log"><div className="section-title"><span>VISIBLE TRAJECTORY</span><small>No private chain-of-thought</small></div>{detail.events.map((event) => <article key={event.id} className={event.level}><time>{new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><div><strong>{event.state.replaceAll("_", " ")}</strong><p>{event.message}</p></div></article>)}</section><aside className="run-aside"><div><span>PROFILE</span><strong>{detail.run.profile_snapshot.label}</strong><p>{detail.run.profile_snapshot.description}</p></div><div><span>MODE</span><strong>{detail.run.input.user_mode === "developer" ? "Developer" : "Investor / publisher"}</strong></div><div><span>LIMITS</span><strong>{detail.run.profile_snapshot.limits.max_external_calls} calls · {detail.run.profile_snapshot.limits.max_critic_cycles} critic cycles</strong></div></aside></div>
    {detail.run.state === "FAILED" ? <div className="failure-box"><ShieldAlert /><div><strong>The run stopped safely</strong><p>{detail.run.error}</p></div><button onClick={() => action("retry")}>RETRY RUN</button></div> : detail.run.state === "CANCELLED" ? <div className="failure-box"><div><strong>Investigation cancelled</strong><p>Captured evidence remains available in the database.</p></div><button onClick={() => action("retry")}>RETRY RUN</button></div> : <button className="cancel-button" onClick={() => action("cancel")}>CANCEL INVESTIGATION</button>}
  </div>;
}

const stateCopy: Record<string, string> = { COLLECT_CORE: "Identity + platform signals", PLAN: "Orchestrator plans its research", EXECUTE: "Orchestrator delegates to sub-agents", RECORD: "Evidence validation", SYNTHESIZE: "Thesis formed", CRITIQUE: "Falsification review", ROUTE: "Objection resolution", FINALIZE: "Structured report" };

function ReportView({ report }: { report: Report }) {
  const [drawer, setDrawer] = useState<string[] | null>(null);
  return <>
    {report.is_fixture && <div className="fixture-banner"><AlertTriangle /> CACHED FIXTURE REPORT — NOT A LIVE AUDIT</div>}
    <div className="report-page">
      <section className="report-hero"><div className="identity"><span className="eyebrow">INVESTIGATION COMPLETE · {new Date(report.game.observed_at).toLocaleString()}</span><h1>{report.game.name}</h1><p>By {report.game.creator} · Place {report.game.place_id} · Universe {report.game.universe_id}</p></div><div className="verdict-panel"><div><span>BREAKOUT POTENTIAL</span><strong>{report.verdict.breakout_potential}</strong></div><div><span>CONFIDENCE</span><strong>{report.verdict.confidence}</strong></div><p>{report.verdict.recommendation}</p></div></section>
      <section className="report-audits"><div className="section-title"><span>AUDIT COVERAGE</span><small>Open any audit to inspect its evidence</small></div><div className="report-audit-grid">{report.audit_cards.map((card) => <button key={card.module_id} onClick={() => setDrawer(card.evidence_ids)}><div><span className={`module-status ${card.status}`}>{card.status}</span><strong>{card.label}</strong></div><p>{card.summary}</p><small>{card.evidence_ids.length} evidence records <ArrowRight /></small></button>)}</div></section>
      <section className="thesis-grid"><ClaimPanel title="WHY IT MAY BREAK OUT" accent="positive" claims={report.supporting_claims} onEvidence={setDrawer} /><ClaimPanel title="WHY IT MAY NOT" accent="negative" claims={report.risk_claims} onEvidence={setDrawer} /></section>
      <section className="critic-card"><div className="section-title"><span>CRITIC REVISION</span><small>{report.critic.changed_assessment ? "Assessment changed after verification" : "Assessment confirmed after verification"}</small></div><div className="revision-row"><div><span>INITIAL</span><strong>{report.initial_verdict.breakout_potential} / {report.initial_verdict.confidence}</strong></div><ArrowRight /><div><span>FINAL</span><strong>{report.verdict.breakout_potential} / {report.verdict.confidence}</strong></div></div><p>{report.critic.summary}</p>{report.critic.objections.map((item) => <details key={item.id}><summary><span className={`severity ${item.severity}`}>{item.severity}</span>{item.summary}<ChevronDown /></summary><p><b>Resolution:</b> {item.resolution_request}</p></details>)}</section>
      <section className="action-card"><div><span className="eyebrow">RECOMMENDED NEXT ACTION</span><h2>{report.next_action}</h2></div><div><span>WHAT TO MONITOR</span><ul>{report.monitor.map((item) => <li key={item}>{item}</li>)}</ul></div></section>
      <section className="limitations"><div className="section-title"><span>LIMITATIONS & RUN DETAILS</span><small>{(report.runtime_ms / 1000).toFixed(1)}s · approximately ${report.approximate_cost_usd.toFixed(4)}</small></div><ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>
    {drawer && <EvidenceDrawer runId={report.run_id} ids={drawer} onClose={() => setDrawer(null)} />}
  </>;
}

function ClaimPanel({ title, accent, claims, onEvidence }: { title: string; accent: string; claims: Report["supporting_claims"]; onEvidence: (ids: string[]) => void }) { return <section className={`claim-panel ${accent}`}><div className="section-title"><span>{title}</span><small>{claims.length} grounded claims</small></div>{claims.map((claim) => <article key={claim.id}><p>{claim.text}</p><button onClick={() => onEvidence(claim.evidence_ids)}>{claim.evidence_ids.length} SOURCES <ArrowRight /></button></article>)}</section>; }

function EvidenceDrawer({ runId, ids, onClose }: { runId: string; ids: string[]; onClose: () => void }) {
  const query = useQuery({ queryKey: ["evidence", runId], queryFn: async () => { const response = await fetch(`/api/runs/${runId}/evidence`); return (await response.json()).evidence as Evidence[]; } });
  const items = (query.data ?? []).filter((item) => ids.includes(item.id));
  return <div className="drawer-backdrop" onClick={onClose}><aside className="evidence-drawer" onClick={(e) => e.stopPropagation()} aria-label="Evidence details"><header><div><span>EVIDENCE WORKSPACE</span><small>{items.length} linked records</small></div><button onClick={onClose} aria-label="Close evidence drawer"><X /></button></header>{query.isLoading ? <div className="drawer-loading"><LoaderCircle className="spin" /></div> : items.map((item) => <article key={item.id}><div className="evidence-tags"><span className={item.kind}>{item.kind}</span><span>{item.support_strength} support</span><span>{item.relationship}</span></div><h3>{item.claim}</h3><dl><div><dt>Observed</dt><dd>{new Date(item.source.retrieved_at).toLocaleString()}</dd></div><div><dt>Source</dt><dd>{item.source.type}</dd></div><div><dt>Evidence ID</dt><dd>{item.id}</dd></div></dl>{item.source.url && <a href={item.source.url} target="_blank" rel="noreferrer">OPEN SOURCE <ExternalLink /></a>}{item.notes && <p className="evidence-note">{item.notes}</p>}</article>)}</aside></div>;
}
