"use client";

import { useEffect } from "react";
import { dispatchTaskActivity, dispatchResync, type TaskActivityScope } from "@/lib/task/liveNotificationsClient";

type StreamPayload = { scope: TaskActivityScope; entityId: string; actorUserId: string; timestamp: string };

function isStreamPayload(value: unknown): value is StreamPayload {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as StreamPayload).scope === "string" &&
    typeof (value as StreamPayload).entityId === "string" &&
    typeof (value as StreamPayload).actorUserId === "string"
  );
}

// Phase 8 — the single owner of this tab's EventSource connection to
// /api/task-notifications/stream. Mounted once in (app)/layout.tsx so it
// stays alive across every route under (app) (Dashboard, Customer,
// Quotation, Policy, Invoice, Ledger, Task, Settings — this phase's spec,
// Part F) without re-connecting on every navigation. Renders nothing;
// every other component that cares about a signal (Sidebar, TaskWorkspace,
// the Claim tables, open detail views) subscribes to the in-page bus in
// src/lib/task/liveNotificationsClient.ts instead of talking to
// EventSource directly — there is exactly one real network connection per
// tab.
export function TaskRealtimeNotifications() {
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource("/api/task-notifications/stream");

      es.addEventListener("task-unread-changed", (event) => {
        try {
          const data: unknown = JSON.parse((event as MessageEvent<string>).data);
          if (isStreamPayload(data)) dispatchTaskActivity(data);
        } catch (err) {
          if (process.env.NODE_ENV !== "production") console.debug("[task-notifications] malformed event payload", err);
        }
      });

      // Heartbeat — nothing to act on, its only job is keeping the
      // connection observably alive through intermediate proxies (this
      // phase's spec, Part C5).
      es.addEventListener("ping", () => {});

      es.onopen = () => {
        // A fresh connection (including the browser's own native retry
        // after a drop) may have missed events while disconnected — DB
        // ReadState is authoritative, so just ask every mounted subscriber
        // to re-check right now (this phase's spec, Part K6).
        dispatchResync();
      };

      es.onerror = () => {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[task-notifications] stream error — the browser will retry automatically");
        }
        // EventSource retries natively; no manual reconnect loop, no global
        // error UI (this phase's spec, Part K3/K4). A stream failure never
        // blocks the rest of the app (Part K5) — this component renders
        // nothing and every consumer treats "no signal" as simply "nothing
        // new to report," never an error state of its own.
      };
    }

    connect();

    // Browsers may pause/suspend a background tab's timers and, in some
    // cases, its open connections — proactively resync on regaining
    // visibility regardless of whether the connection actually dropped
    // (this phase's spec, Part J), so a laptop waking from sleep or a tab
    // coming back to the foreground is never stale.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") dispatchResync();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      es?.close();
    };
  }, []);

  return null;
}
