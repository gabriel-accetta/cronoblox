"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Download, Plug, Terminal, X } from "lucide-react";

type Client = "claude" | "chatgpt" | "other";
const clients: Array<{ id: Client; label: string }> = [
  { id: "claude", label: "Claude" }, { id: "chatgpt", label: "ChatGPT" }, { id: "other", label: "Other clients" },
];

function ClientMark({ client }: { client: Client }) {
  if (client === "other") return <Terminal aria-hidden="true" />;
  return <img className="integration-client-logo" src={`/client-logos/${client}.svg`} width={20} height={20} alt="" aria-hidden="true" />;
}

function CopyButton({ value, label, disabled = false }: { value: string; label: string; disabled?: boolean }) {
  const [state, setState] = useState<"ready" | "copied" | "manual">("ready");
  const fallback = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setState("ready"); }, [value]);
  useEffect(() => {
    if (state === "manual") { fallback.current?.focus(); fallback.current?.select(); }
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("ready"), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setState("copied"); }
    catch { setState("manual"); }
  }
  return <div className="integration-copy-control">
    <button type="button" className="integration-button secondary" disabled={disabled} onClick={copy}>
      {state === "copied" ? <Check /> : <Copy />} {state === "copied" ? "Copied" : label}
    </button>
    <span className="sr-only" role="status">{state === "copied" ? `${label} copied to clipboard` : ""}</span>
    {state === "manual" && <div className="integration-manual-copy"><p>Clipboard access is blocked. Select and copy this text:</p><textarea ref={fallback} readOnly aria-label={`${label} text`} value={value} rows={4} /></div>}
  </div>;
}

export function IntegrationCard({ gameUrl }: { gameUrl: string }) {
  const [selected, setSelected] = useState<Client | null>(null);
  const [connection, setConnection] = useState<{ endpoint: string; local: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = selected ?? "claude";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations", { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Connection details are unavailable.");
      setConnection(result);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Connection details are unavailable."); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (selected && !element.open) element.showModal();
    if (!selected && element.open) element.close();
    if (!selected) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [selected]);

  const starter = `Use the connected Cronoblox tools to investigate ${gameUrl.trim() ? JSON.stringify(gameUrl.trim()) : "this Roblox game: [paste game URL]"}. Start with cronoblox_audit_game, then research relevant peers and YouTube coverage if useful. Cite returned evidence IDs and source URLs, preserve observation times and warnings, and distinguish facts from inferences. A snapshot does not establish growth or retention; missing data is unknown. Challenge your initial thesis and hold or lower its breakout category (LOW, MODERATE, HIGH, VERY HIGH); never give a numerical breakout probability. If evidence is insufficient, say so. Give supporting signals, risks, comparables, limitations and next steps. This is your interpretation of Cronoblox evidence, not a saved Cronoblox report or an independent critic run. Do not call a paid hosted investigation. If the tools are not connected, tell me how to connect them first.`;
  const endpoint = connection?.endpoint ?? "";
  const localMessage = connection?.local ? "Local preview: Claude and ChatGPT need a public HTTPS endpoint. Deploy the app and set CRONOBLOX_PUBLIC_URL before sharing the plugin. Local MCP clients can use this address." : null;

  return <div className="ai-integration">
    <div className="integration-card" role="group" aria-label="Use Cronoblox in your AI client">
      <button type="button" className="integration-trigger" onClick={() => setSelected("claude")} aria-haspopup="dialog"><Plug /><span>Add to your AI</span></button>
      <span className="integration-divider" aria-hidden="true" />
      <div className="integration-client-shortcuts">{clients.map(({ id, label }) => <button key={id} type="button" title={`Use in ${label}`} aria-label={`Use in ${label}`} aria-haspopup="dialog" onClick={() => setSelected(id)}><ClientMark client={id} /></button>)}</div>
    </div>
    <p className="integration-caption">Your AI. Our tools. No API key.</p>

    <dialog ref={dialog} className="integration-dialog" aria-labelledby="integration-title" aria-describedby="integration-description" onClose={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <div className="integration-panel">
        <button type="button" className="integration-close" aria-label="Close installation instructions" onClick={() => setSelected(null)}><X /></button>
        <div className="integration-eyebrow"><Plug /> BRING YOUR OWN AI</div>
        <h2 id="integration-title">Cronoblox, in your chat.</h2>
        <p id="integration-description">Live Roblox tools and our investigation playbook.<br />Your AI handles the thinking, using your plan’s allowance.</p>
        <div className="integration-tabs" role="tablist" aria-label="AI client">{clients.map(({ id, label }) => <button key={id} id={`client-tab-${id}`} role="tab" aria-selected={active === id} aria-controls="integration-instructions" tabIndex={active === id ? 0 : -1} type="button" onClick={() => setSelected(id)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = clients.findIndex((client) => client.id === id);
          const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
          const client = clients[next]!;
          setSelected(client.id); document.getElementById(`client-tab-${client.id}`)?.focus();
        }}><ClientMark client={id} />{label}</button>)}</div>

        <div id="integration-instructions" role="tabpanel" aria-labelledby={`client-tab-${active}`}>
          {error && <p className="form-error" role="alert">{error}</p>}
          {!connection && !error && <p className="integration-note" role="status">Loading connection details…</p>}
          {localMessage && <p className="integration-warning">{localMessage}</p>}
          {active === "claude" && <ol className="integration-steps">
            <li><div><h3>Add the plugin</h3><p>Download the bundle, then open <strong>Customize → Plugins</strong> in Claude and upload it as a custom plugin.</p>
              <div className="integration-actions"><a className={`integration-button primary ${!connection ? "disabled" : ""}`} aria-disabled={!connection} href={connection ? "/api/integrations/download?client=claude" : undefined} download><Download /> Download Claude plugin</a><a className="integration-text-link" href="https://claude.ai/" target="_blank" rel="noreferrer">Open Claude <ArrowUpRight /></a></div>
            </div></li>
            <li><div><h3>Enable Cronoblox and start a chat</h3><p>Review the tools and enable the connector. Ask about any public Roblox game; the bundled skill guides the investigation.</p><CopyButton value={starter} label="Copy starter prompt" /></div></li>
          </ol>}
          {active === "chatgpt" && <ol className="integration-steps">
            <li><div><h3>Connect the tools</h3><p>Enable <strong>Developer mode</strong> in Settings → Security and login. Open Plugins, select <strong>+</strong>, and add Cronoblox using the URL below. Choose <strong>No authentication</strong>.</p>
              <div className="integration-endpoint"><code>{endpoint || "Loading endpoint…"}</code><CopyButton value={endpoint} label="Copy URL" disabled={!connection} /></div>
              <a className="integration-text-link" href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">Open ChatGPT Plugins <ArrowUpRight /></a>
            </div></li>
            <li><div><h3>Start your investigation</h3><p>Enable Cronoblox in a new chat and paste the starter prompt. It includes the evidence and review guidelines.</p><CopyButton value={starter} label="Copy starter prompt" /></div></li>
          </ol>}
          {active === "other" && <ol className="integration-steps">
            <li><div><h3>Connect any remote MCP client</h3><p>Add an HTTP MCP server named <strong>Cronoblox</strong>. No login, token or API key is required.</p><div className="integration-endpoint"><code>{endpoint || "Loading endpoint…"}</code><CopyButton value={endpoint} label="Copy URL" disabled={!connection} /></div><CopyButton value={JSON.stringify({ mcpServers: { cronoblox: { type: "http", url: endpoint } } }, null, 2)} label="Copy MCP configuration" disabled={!connection} /></div></li>
            <li><div><h3>Bring the playbook</h3><p>Add our skill to a client that supports skills, or use the starter prompt in your conversation.</p><div className="integration-actions"><a className="integration-text-link" href="/integrations/investigate-roblox/SKILL.md" download="SKILL.md"><Download /> Download skill</a><CopyButton value={starter} label="Copy starter prompt" /></div></div></li>
          </ol>}

          <details className="integration-alternative"><summary>{active === "claude" ? "No plugin upload? Connect manually" : "Using ChatGPT desktop or Codex?"}</summary>
            {active === "claude" ? <div><p>In Customize → Connectors, add a custom connector named Cronoblox with this URL. Enable it in your chat, then use the starter prompt above or <a href="/integrations/investigate-roblox/SKILL.md" download>download the skill</a>.</p><div className="integration-endpoint"><code>{endpoint}</code><CopyButton value={endpoint} label="Copy MCP URL" disabled={!connection} /></div></div>
              : <div><p>The desktop bundle includes the skill, MCP connection and a local marketplace. Extract it into <code>cronoblox-plugin</code>, then register the folder:</p><pre>codex plugin marketplace add ./cronoblox-plugin</pre><p>Restart the desktop app, choose Cronoblox in the Plugins Directory and install it. Start a new conversation.</p><a className={`integration-button secondary ${!connection ? "disabled" : ""}`} aria-disabled={!connection} href={connection ? "/api/integrations/download?client=openai" : undefined} download><Download /> Download desktop plugin</a></div>}
          </details>
          <p className="integration-note">Client plan and workspace permissions apply. Custom installation is available here; this is not a published directory listing.</p>
        </div>
        <footer className="integration-footer"><span><span className="integration-status-dot" /> PUBLIC HACKATHON PREVIEW</span><p>No Cronoblox model charges. No account required. Results stay in your chat; no report is saved here. Public queries and evidence may be cached in server memory for 60 seconds. Availability is limited to the event.</p></footer>
      </div>
    </dialog>
  </div>;
}
