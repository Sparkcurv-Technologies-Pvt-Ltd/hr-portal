import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Plugs, PlugsConnected } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";

const encoder = new TextEncoder();

// In-browser terminal over a WebSocket to /api/ssh/ws/{server}. Binary frames are the terminal's input/output;
// JSON text frames carry status messages. The SSH login itself never reaches the browser.
export function TerminalPanel({ server, level, ticket, onClose }) {
  const holder = useRef(null);
  const [state, setState] = useState("connecting");   // connecting | connected | closed
  const [note, setNote] = useState("");
  const socketRef = useRef(null);

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: "Menlo, Consolas, 'DejaVu Sans Mono', monospace", scrollback: 5000,
      theme: { background: "#0B1020", foreground: "#E2E8F0", cursor: "#7DD3FC" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(holder.current);
    fit.fit();

    // Connect on a short timer: React's dev double-mount would otherwise open (and immediately drop) a throw-away session
    let ws = null, observer = null, input = null;
    const timer = setTimeout(() => {
      const base = (API_BASE || window.location.origin).replace(/^http/, "ws");
      ws = new WebSocket(`${base}/api/ssh/ws/${server.id}?level=${level}&ticket_id=${ticket || 0}&cols=${term.cols}&rows=${term.rows}`);
      ws.binaryType = "arraybuffer";
      socketRef.current = ws;

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          const msg = JSON.parse(ev.data);
          if (msg.type === "status") { setNote(msg.message); if (msg.message === "Connected") { setState("connected"); term.focus(); } else term.writeln(`\x1b[36m${msg.message}\x1b[0m`); }
          else if (msg.type === "error") { term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`); setNote(msg.message); }
          else if (msg.type === "closed") { term.writeln(`\r\n\x1b[33m[session closed: ${msg.message}]\x1b[0m`); setState("closed"); }
        } else {
          term.write(new Uint8Array(ev.data));
        }
      };
      ws.onclose = () => setState(s => (s === "closed" ? s : "closed"));
      ws.onerror = () => { term.writeln("\r\n\x1b[31mCouldn't reach the terminal service.\x1b[0m"); setState("closed"); };

      input = term.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(d)); });
      const sendSize = () => { fit.fit(); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })); };
      observer = new ResizeObserver(sendSize);
      observer.observe(holder.current);


    }, 50);

    return () => { clearTimeout(timer); observer?.disconnect(); input?.dispose(); ws?.close(); term.dispose(); };
  }, [server.id, level, ticket]);

  return (
    <div data-testid="ssh-terminal">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className={`chip ${state === "connected" ? "tone-green" : state === "closed" ? "tone-red" : "tone-amber"}`}>{state === "connected" ? "Connected" : state === "closed" ? "Disconnected" : "Connecting…"}</span>
        <p className="text-sm"><strong>{server.name}</strong> <span style={{ color: "var(--text-muted)" }}>· {server.client_name} · {level.toUpperCase()} login{ticket ? ` · ticket linked` : ""}</span></p>
        <Button variant="outline" className="rounded-xl h-9 ml-auto" onClick={onClose} data-testid="ssh-disconnect-btn">{state === "closed" ? <><Plugs className="h-4 w-4 mr-1.5" /> Back to servers</> : <><PlugsConnected className="h-4 w-4 mr-1.5" /> Disconnect</>}</Button>
      </div>
      <div className="rounded-2xl p-3" style={{ background: "#0B1020", border: "1px solid #1E293B" }}>
        <div ref={holder} style={{ height: "min(65vh, 560px)", width: "100%" }} data-testid="ssh-terminal-screen" />
      </div>
      <p className="text-[11px] mt-2" style={{ color: "var(--text-subtle)" }}>This session is logged (who, server, login, time){ticket ? " and noted on the ticket" : ""}. What you type and see is not recorded. It closes after 15 minutes idle or 60 minutes.{note && state !== "connected" ? ` — ${note}` : ""}</p>
    </div>
  );
}
