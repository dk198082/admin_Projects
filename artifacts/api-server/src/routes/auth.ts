import { Router, type IRouter } from "express";
import * as oidcClient from "openid-client";
import { eq } from "drizzle-orm";
import { db, appUsersTable } from "@workspace/db";
import { getOidcConfig, getRedirectUri } from "../lib/oidc";
import { logAudit } from "../lib/audit";

declare module "express-session" {
  interface SessionData {
    codeVerifier?: string;
    oauthState?: string;
    user?: {
      id: number;
      entraObjectId: string;
      email: string;
      name: string;
    };
  }
}

const router: IRouter = Router();

router.get("/auth/login", async (req, res, next) => {
  try {
    const config = await getOidcConfig();
    const codeVerifier = oidcClient.randomPKCECodeVerifier();
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
    const state = oidcClient.randomState();

    req.session.codeVerifier = codeVerifier;
    req.session.oauthState = state;

    const url = oidcClient.buildAuthorizationUrl(config, {
      redirect_uri: getRedirectUri(req),
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });
    res.redirect(url.href);
  } catch (err) {
    next(err);
  }
});

router.get("/auth/callback", async (req, res, next) => {
  try {
    const config = await getOidcConfig();
    const { codeVerifier, oauthState } = req.session;
    if (!codeVerifier || !oauthState) {
      res.redirect("/?auth_error=session_expired");
      return;
    }

    const currentUrl = new URL(
      `${getRedirectUri(req).split("/api/")[0]}${req.originalUrl}`,
    );
    const tokens = await oidcClient.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: oauthState,
    });

    const claims = tokens.claims();
    if (!claims?.sub) {
      res.redirect("/?auth_error=no_claims");
      return;
    }

    const entraObjectId = String(claims.oid ?? claims.sub);
    const email = String(
      claims.email ?? claims.preferred_username ?? "unknown",
    );
    const name = String(claims.name ?? email);

    const [appUser] = await db
      .insert(appUsersTable)
      .values({ entraObjectId, email, name })
      .onConflictDoUpdate({
        target: appUsersTable.entraObjectId,
        set: { email, name, lastLoginAt: new Date() },
      })
      .returning();

    // Regenerate the session ID on login to prevent session fixation.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.user = {
      id: appUser.id,
      entraObjectId: appUser.entraObjectId,
      email: appUser.email,
      name: appUser.name,
    };

    await logAudit("login", "Session", `${name} (${email}) signed in via Entra ID`, name);
    res.redirect("/");
  } catch (err) {
    req.log.error({ err }, "Entra ID callback failed");
    res.redirect("/?auth_error=callback_failed");
  }
});

router.get("/auth/me", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(req.session.user);
});

router.post("/auth/logout", (req, res) => {
  const name = req.session.user?.name;
  req.session.destroy(() => {
    res.json({ ok: true, loggedOutUser: name ?? null });
  });
});

router.get("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

export default router;
