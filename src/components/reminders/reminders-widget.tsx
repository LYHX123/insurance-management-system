"use client";

import { useEffect, useRef, useState } from "react";
import { getRemindersAction } from "@/lib/reminders/actions";
import type { ReminderItem } from "@/lib/reminders/service";
import { buildReminderDismissKey, shouldAutoOpenReminders } from "@/lib/reminders/autoOpen";
import { ReminderBell } from "./reminder-bell";
import { ReminderPanel } from "./reminder-panel";

// Rendered once inside the persistent authenticated layout (Topbar), so the
// effect below runs exactly once per full page load / session — Next.js
// keeps this component mounted across client-side navigations within the
// (app) route group, which is what keeps this from re-fetching or
// re-opening on every route change (Part 14/Part 17.9). See
// src/lib/reminders/autoOpen.ts for the dismiss-key scoping and open/no-open
// decision (kept as pure, unit-tested functions).
export function RemindersWidget({ accountKey }: { accountKey: string }) {
  const dismissKey = buildReminderDismissKey(accountKey);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const hasLoaded = useRef(false);

  useEffect(() => {
    let cancelled = false;

    getRemindersAction().then((result) => {
      if (cancelled) return;
      setReminders(result.items);
      hasLoaded.current = true;

      const alreadyDismissed = sessionStorage.getItem(dismissKey) === "1";
      if (shouldAutoOpenReminders({ loginReminderPopupEnabled: result.loginReminderPopupEnabled, itemCount: result.items.length, alreadyDismissed })) {
        setIsOpen(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [dismissKey]);

  const handleClose = () => {
    setIsOpen(false);
    sessionStorage.setItem(dismissKey, "1");
  };

  return (
    <>
      <ReminderBell count={reminders.length} onClick={() => setIsOpen((v) => !v)} />
      {isOpen && <ReminderPanel reminders={reminders} onClose={handleClose} />}
    </>
  );
}
