-- Remove the public API-key feature (model ApiKey).
-- Keys could be ISSUED (admin CRUD at /api/api-keys storing a sha256 keyHash + scopes) but
-- NO middleware ever read X-API-Key/Bearer to authenticate a request with them, and there was
-- no management UI — so issued keys authenticated nothing (dead half-feature). This is an
-- internal staff tool with no programmatic/integration consumers. Removing the dead surface.
-- The FK ApiKey.createdById -> User (onDelete SetNull) is dropped together with the table.
DROP TABLE IF EXISTS "ApiKey";
