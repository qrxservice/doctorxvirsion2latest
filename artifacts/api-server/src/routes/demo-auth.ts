import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";

type DemoUser = {
  id: number;
  email: string;
  name: string;
  role: "doctor";
  doctorId: number;
  createdAt: string;
};

type AuthResponse = {
  user?: DemoUser;
  token?: string;
};

const router: IRouter = Router();
const sessions = new Map<string, DemoUser>();

const demoUser: DemoUser = {
  id: 1,
  email: "doctor@example.com",
  name: "Demo Doctor",
  role: "doctor",
  doctorId: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function bearerToken(req: Request): string | null {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function isLoginBody(value: unknown): value is { email: string; password: string } {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return typeof body.email === "string" && typeof body.password === "string";
}

/**
 * Temporary preview authentication for the standalone frontend artifact.
 * This is intentionally in-memory and must be replaced by the real DoctorX
 * authentication service before using the app with real patient data.
 */
router.post("/auth/login", (req, res): void => {
  if (!isLoginBody(req.body)) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const email = req.body.email.trim().toLowerCase();
  if (email !== demoUser.email || req.body.password !== "doctor123") {
    req.log.warn({ email }, "Rejected demo login");
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const token = `demo-${randomUUID()}`;
  sessions.set(token, demoUser);
  const response: AuthResponse = { token, user: demoUser };
  req.log.info({ email }, "Demo login accepted");
  res.json(response);
});

router.get("/auth/me", (req, res): void => {
  const user = sessions.get(bearerToken(req) ?? "");
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  res.json(user);
});

router.post("/auth/logout", (req, res): void => {
  const token = bearerToken(req);
  if (token) sessions.delete(token);
  res.sendStatus(204);
});

export default router;