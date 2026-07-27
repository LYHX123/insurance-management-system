// Full Name is now the login identifier: trim outer whitespace, collapse
// internal whitespace runs, and compare case-insensitively everywhere
// (uniqueness check, login lookup) so "YANG YUEHUA" / "Yang Yuehua" /
// " yang yuehua " are all the same account.
export function normalizeFullName(fullName: string): string {
  return fullName.trim().replace(/\s+/g, " ");
}

// A URL/DB-safe legacy `username` value for newly-created users only —
// existing users keep their original username untouched (see
// createUserAction's doc comment for why).
export function usernameFromFullName(fullName: string): string {
  return normalizeFullName(fullName);
}
