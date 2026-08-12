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
    
     req.log.info(
   {
      sessionID: req.sessionID,
      cookie: req.headers.cookie,
    },
  "LOGIN SESSION SAVED",
);
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

      req.log.info(
    {
      sessionID: req.sessionID,
      returnedState: req.query.state,
      cookie: req.headers.cookie,
    },
    "AUTH CALLBACK SESSION",
  );

    const config = await getOidcConfig();
    const { codeVerifier, oauthState } = req.session;
    if (!codeVerifier || !oauthState) {
      const FRONTEND_URL =
           process.env.FRONTEND_URL ?? "http://localhost:5175";
      // res.redirect("/?auth_error=session_expired");
      res.redirect(
                 `${FRONTEND_URL}/?auth_error=session_expired`,);
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

router.get("/me", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!req.session.user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  res.status(200).json(req.session.user);
});


router.post("/auth/logout", async (req, res) => {
  const name = req.session.user?.name;
  if (name) {
    try {
      await logAudit("logout", "Session", `${name} signed out`, name);
    } catch (err) {
      req.log.error({ err }, "Failed to write logout audit entry");
    }
  }
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
