// Task/Claim User-Level Unread Indicator — a small, quiet dot, deliberately
// not a badge/count/toast (see this phase's spec, Part B6: no large badge,
// no "Unread" text, no popup, no extra Bell notification — just this one
// dot). Renders nothing at all when not unread, so callers can place it
// unconditionally without an extra `isUnread &&` wrapper at each call site.
export function UnreadDot({ show, className = "" }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span
      aria-label="Unread"
      title="Unread"
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-red-500 ${className}`}
    />
  );
}
