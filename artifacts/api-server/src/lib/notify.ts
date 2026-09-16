import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function notify(
  userId: number,
  type: string,
  title: string,
  message: string,
  relatedId?: number,
): Promise<void> {
  await db.insert(notificationsTable).values({ userId, type, title, message, relatedId: relatedId ?? null });
}

export async function notifyAdmins(
  type: string,
  title: string,
  message: string,
  relatedId?: number,
): Promise<void> {
  const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
  if (!admins.length) return;
  await db.insert(notificationsTable).values(
    admins.map(a => ({ userId: a.id, type, title, message, relatedId: relatedId ?? null }))
  );
}
