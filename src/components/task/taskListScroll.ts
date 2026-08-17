// Phase 7 Part B — deliberately module-level state, not React state/context:
// it must survive whatever actually resets TaskWorkspace's rendered DOM on
// task-selection navigation (Next.js's default <Link> scroll-to-top
// behavior, and/or a full remount of the list container if one occurs —
// see task-workspace.tsx's own doc comment for the audit findings), which a
// component-local ref cannot do once its owning component instance is gone.
// Scoped per category (Map keyed by TaskCategorySlug) so switching
// Daily Task -> Motor Claim -> Daily Task never applies one module's scroll
// position to another's list (Part B, Case 2) — even though only "daily"
// exists as a key today (Motor Claim/Non-Motor Claim use MotorClaimTable/
// NonMotorClaimTable, not TaskWorkspace, see task-workspace.tsx's doc
// comment), keying by category costs nothing and avoids ever silently
// reusing a stale value if a future category adopts this same workspace.
// In-memory only (not sessionStorage) — resets on a real page reload, which
// is expected/acceptable; this is a same-session UX nicety, not durable
// state worth persisting or worth the staleness-invalidation complexity of
// a storage API.
const positions = new Map<string, number>();

export function saveTaskListScroll(categorySlug: string, scrollTop: number): void {
  positions.set(categorySlug, scrollTop);
}

export function getTaskListScroll(categorySlug: string): number | undefined {
  return positions.get(categorySlug);
}

export function clearTaskListScroll(categorySlug: string): void {
  positions.delete(categorySlug);
}
