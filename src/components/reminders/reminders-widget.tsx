"use client";

import { useEffect, useRef, useState } from "react";
import { getRemindersAction } from "@/lib/reminders/actions";
import type { ReminderItem } from "@/lib/reminders/service";
import { ReminderBell } from "./reminder-bell";
import { ReminderPanel } from "./reminder-panel";

// Closing the popup only dismisses the *automatic* open-on-load for the
// rest of this browser session (Part 14) — it never marks any underlying
// business condition as resolved, and the bell keeps working regardless.
const SESSION_DISMISS_KEY = "reminders-auto-dismissed";

// Rendered once inside the persistent authenticated layout (Topbar), so the
// effect below runs exactly once per full page load / session — Next.js
// keeps this component mounted across client-side navigations within the
// (app) route group, which is what keeps this from re-fetching or
// re-opening on every route change (Part 14/Part 17.9).
export function RemindersWidget() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const hasLoaded = useRef(false);

  useEffect(() => {
    let cancelled = false;

    getRemindersAction().then((result) => {
      if (cancelled) return;
      setReminders(result.items);
      hasLoaded.current = true;

      const alreadyDismissed = sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
      if (result.loginReminderPopupEnabled && !alreadyDismissed && result.items.length > 0) {
        setIsOpen(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
  };

  return (
    <>
      <ReminderBell count={reminders.length} onClick={() => setIsOpen((v) => !v)} />
      {isOpen && <ReminderPanel reminders={reminders} onClose={handleClose} />}
    </>
  );
}
