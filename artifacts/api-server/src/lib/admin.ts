import { eq } from "drizzle-orm";
import { db, usersTable, auditLogsTable } from "@workspace/db";
import { verifyAuthToken } from "./token";

export interface Actor {
  userId: number | null;
  role: string | null;
  name: string | null;
  doctorId: number | null;
}

// Verify the HMAC-signed token and resolve the persisted user.
// We trust the persisted role/doctorId, NOT the token claims, and reject any
// token whose signature does not verify (prevents userId forgery/impersonation).
export async function getActor(auth: string | undefined): Promise<Actor> {
  const empty: Actor = { userId: null, role: null, name: null, doctorId: null };
  const claims = verifyAuthToken(auth);
  if (!claims) return empty;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user) return empty;
    return { userId: user.id, role: user.role, name: user.name, doctorId: user.doctorId ?? null };
  } catch {
    return empty;
  }
}

export async function isAdmin(auth: string | undefined): Promise<boolean> {
  const actor = await getActor(auth);
  return actor.role === "admin";
}

export async function writeAudit(
  actor: Actor,
  action: string,
  entityType: string,
  entityId: number | null,
  details?: string,
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorUserId: actor.userId,
      actorRole: actor.role,
      actorName: actor.name,
      action,
      entityType,
      entityId,
      details: details ?? null,
    });
  } catch {
    // Audit logging must never break the underlying operation.
  }
}
