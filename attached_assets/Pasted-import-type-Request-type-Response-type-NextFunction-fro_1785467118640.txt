import { type Request, type Response, type NextFunction } from "express";
import {
  ConfidentialClientApplication,
  type Configuration,
} from "@azure/msal-node";
import { logger } from "./logger.js";

// The Azure App Registration credentials are stored in this project under
// CLIENT_ID / TENANT_ID / CLIENT_SECRET. We also accept the ENTRA_* names used
// by the original reference server so either naming works.
const CLIENT_ID = process.env.ENTRA_CLIENT_ID ?? process.env.CLIENT_ID;
const TENANT_ID = process.env.ENTRA_TENANT_ID ?? process.env.TENANT_ID;
const CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET ?? process.env.CLIENT_SECRET;

// The redirect URI must exactly match one registered on the Azure app
// registration. Auth routes are mounted under /api, so the callback ALWAYS
// lives at the "/api/auth/callback" path — a bare "/auth/callback" can never
// work because the shared proxy only routes "/api/*" to this server.
//
// We derive the *origin* from (in priority order): an explicit
// ENTRA_REDIRECT_URI override, else the current Replit domain, else localhost —
// but we always force the "/api/auth/callback" path onto it. This makes the
// value robust against a stale/legacy ENTRA_REDIRECT_URI (e.g. one left over
// from the original standalone server that pointed at ".../auth/callback"
// without the "/api" segment), which would otherwise silently break login.
const CALLBACK_PATH = "/api/auth/callback";

function resolveRedirectUri(): string {
  const override = process.env.ENTRA_REDIRECT_URI;
  if (override) {
    try {
      // Keep only the origin from the override; the path is fixed by routing.
      return new URL(override).origin + CALLBACK_PATH;
    } catch {
      logger.warn(
        "ENTRA_REDIRECT_URI is not a valid URL; ignoring it and deriving the redirect URI from REPLIT_DOMAINS",
      );
    }
  }
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  return domain
    ? `https://${domain}${CALLBACK_PATH}`
    : `http://localhost:8080${CALLBACK_PATH}`;
}

export const REDIRECT_URI = resolveRedirectUri();

logger.info({ redirectUri: REDIRECT_URI }, "Entra OAuth redirect URI resolved");

export const LOGIN_SCOPES = ["openid", "profile", "email"];

export function isAuthConfigured(): boolean {
  return Boolean(CLIENT_ID && TENANT_ID && CLIENT_SECRET);
}

let cachedClient: ConfidentialClientApplication | null = null;

// Lazily construct the MSAL client so the API server still boots when auth is
// not configured; the auth routes surface a clear 503 in that case.
export function getMsalClient(): ConfidentialClientApplication {
  if (!isAuthConfigured()) {
    throw new Error(
      "Azure auth is not configured: set CLIENT_ID, TENANT_ID and CLIENT_SECRET",
    );
  }
  if (!cachedClient) {
    const config: Configuration = {
      auth: {
        clientId: CLIENT_ID as string,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: CLIENT_SECRET as string,
      },
    };
    cachedClient = new ConfidentialClientApplication(config);
  }
  return cachedClient;
}

export const LOGOUT_URL = `https://login.microsoftonline.com/${TENANT_ID ?? "common"}/oauth2/v2.0/logout`;

export interface SessionUser {
  entraOid: string;
  email: string | undefined;
  displayName: string | undefined;
  role: string;
}

export function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ message: "Login required" });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.session.user) {
      res.status(401).json({ message: "Login required" });
      return;
    }
    if (!roles.includes(req.session.user.role)) {
      res.status(403).json({ message: "Access denied" });
      return;
    }
    next();
  };
}

if (!isAuthConfigured()) {
  logger.warn(
    "Azure auth credentials are not fully set (CLIENT_ID/TENANT_ID/CLIENT_SECRET); /api/login will return 503 until configured",
  );
}

// Augment express-session so req.session.user / authState are typed everywhere.
declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    authState?: string;
    returnTo?: string;
  }
}
