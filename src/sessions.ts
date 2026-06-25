import { prisma } from "./db.js";
import { logger } from "./logger.js";

/**
 * Destroy every persisted cookie session of a user (connect-pg-simple rows in
 * user_sessions). Called whenever the user's credentials change — password
 * change, reset, admin reset — so a stolen session can't outlive the rotation.
 *
 * `keepSid` preserves the caller's own (just re-authenticated) session.
 */
export async function destroyAllSessions(userId: number, keepSid: string | null = null) {
  try {
    await prisma.$executeRaw`
      DELETE FROM user_sessions
      WHERE (sess ->> 'userId')::int = ${Number(userId)}
        AND sid <> ${keepSid ?? ""}`;
  } catch (e) {
    // Session table missing (tests without the PG store) or transient DB issue —
    // log loudly: this is a security control, not a best-effort cleanup.
    logger.error({ err: e instanceof Error ? e.message : String(e), userId }, "destroyAllSessions failed");
  }
}
