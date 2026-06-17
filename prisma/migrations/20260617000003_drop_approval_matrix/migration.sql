-- Drop the ApprovalMatrix model.
-- The amount-band approval matrix was scaffolded (CRUD API + builder UI) but never
-- wired into the approval engine (src/approval.js always creates a single level-1
-- row). The config UI was also unreachable (no route/nav). Removing the dead surface
-- so admins can't configure approval rules that have zero effect.
--
-- PROD-SAFE: the table is unreferenced (no FKs in or out) and was never populated
-- through any reachable code path. DROP cascades its own index automatically.
DROP TABLE IF EXISTS "ApprovalMatrix";
