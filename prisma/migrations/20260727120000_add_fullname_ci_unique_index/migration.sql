-- Full Name is now the login identifier and must be unique case-insensitively
-- (e.g. "YANG YUEHUA" and "Yang Yuehua" can never both exist). The app layer
-- already enforces trimming on every write, so a plain LOWER() index (no
-- TRIM() needed) is sufficient going forward. Purely additive: only fails if
-- two existing rows already collide case-insensitively, which is not the
-- case for the current data.
CREATE UNIQUE INDEX "User_fullName_lower_key" ON "User" (LOWER("fullName"));
