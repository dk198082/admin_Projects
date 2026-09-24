import { Router, type IRouter } from "express";
import * as oidcClient from "openid-client";
import { and, eq } from "drizzle-orm";
import {
  db,
  appUsersTable,
  usersTable,
  roleAssignmentsTable,
  rolesTable,
  appsTable,
} from "@workspace/db";
import { getOidcConfig, getRedirectUri } from "../lib/oidc";
import { logAudit } from "../lib/audit";
import { verifyEmbeddedSsoToken } from "../lib/embedded-sso";

declare module "express-session" {
  interface SessionData {
    codeVerifier?: string;
    oauthState?: string;
    embeddedLogin?: boolean;  // added for embedd login 
    user?: {
      id: number;
      entraObjectId: string;
      email: string;
      name: string;
    };
  }
}

const router: IRouter = Router();
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5175";
router.get("/auth/login", async (req, res, next) => {
  try {

    const embeddedLogin = req.query.embedded === "1";   // added for embedded login 
    req.session.embeddedLogin = embeddedLogin;

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

router.get("/auth/embedded-sso", async (req, res, next) => {
  try {
    const token =
      typeof req.query.token === "string"
        ? req.query.token
        : "";

    const returnTo =
      typeof req.query.returnTo === "string"
        ? req.query.returnTo
        : "/";

    req.log.info(
      {
        hasToken: Boolean(token),
        returnTo,
      },
      "Admin Console embedded SSO started",
    );

    if (!token) {
      res.status(400).type("text").send("Missing SSO token.");
      return;
    }

    const identity = verifyEmbeddedSsoToken(
      token,
      "admin-console",
    );

    if (!identity) {
      req.log.warn(
        "Admin Console embedded SSO token invalid or expired",
      );

      res
        .status(401)
        .type("text")
        .send("Invalid or expired SSO token.");

      return;
    }

    const entraObjectId = identity.sub;
    const email = identity.email;
    const name = identity.name;

    // Verify that the user has an active Admin Console entitlement.
    const [entitled] = await db
      .select({
        userId: usersTable.id,
      })
      .from(usersTable)
      .innerJoin(
        roleAssignmentsTable,
        eq(
          roleAssignmentsTable.userId,
          usersTable.id,
        ),
      )
      .innerJoin(
        rolesTable,
        eq(
          roleAssignmentsTable.roleId,
          rolesTable.id,
        ),
      )
      .innerJoin(
        appsTable,
        eq(
          rolesTable.appId,
          appsTable.id,
        ),
      )
      .where(
        and(
          eq(
            usersTable.entraObjectId,
            entraObjectId,
          ),
          eq(
            usersTable.status,
            "active",
          ),
          eq(
            rolesTable.isEntitlement,
            true,
          ),
          eq(
            appsTable.name,
            "Admin Console",
          ),
        ),
      )
      .limit(1);

    if (!entitled) {
      req.log.warn(
        {
          entraObjectId,
          email,
          name,
        },
        "Embedded SSO denied: no Admin Console entitlement",
      );

      await logAudit(
        "ACCESS_DENIED",
        entraObjectId,
        `${name} (${email}) denied Admin Console embedded login — no entitlement assigned`,
        name,
      );

      res
        .status(403)
        .type("text")
        .send(
          "User is authenticated but not authorized for Admin Console.",
        );

      return;
    }

    // Create/update the Admin Console application user.
    const [appUser] = await db
      .insert(appUsersTable)
      .values({
        entraObjectId,
        email,
        name,
      })
      .onConflictDoUpdate({
        target: appUsersTable.entraObjectId,
        set: {
          email,
          name,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    // Regenerate session ID to prevent session fixation.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });

    req.session.user = {
      id: appUser.id,
      entraObjectId: appUser.entraObjectId,
      email: appUser.email,
      name: appUser.name,
    };

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });

    await logAudit(
      "login",
      "Session",
      `${name} (${email}) signed in via Workspace SSO`,
      name,
    );

    const safeReturnTo =
      returnTo.startsWith("/") &&
      !returnTo.startsWith("//") &&
      !returnTo.includes("\\")
        ? returnTo
        : "/";

    req.log.info(
      {
        entraObjectId,
        email,
        sessionId: req.sessionID,
      },
      "Admin Console embedded SSO session created",
    );

    res.redirect(safeReturnTo);
  } catch (err) {
    req.log.error(
      { err },
      "Admin Console embedded SSO failed",
    );

    next(err);
  }
});

router.get("/auth/callback", async (req, res, next) => {
  try {
    const config = await getOidcConfig();
    const { codeVerifier, oauthState,embeddedLogin } = req.session;
    if (!codeVerifier || !oauthState) {
      res.redirect(`${FRONTEND_URL}/?auth_error=session_expired`);
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
      // res.redirect("/?auth_error=no_claims");
      res.redirect(`${FRONTEND_URL}/?auth_error=no_claims`);
      return;
    }

    const entraObjectId = String(claims.oid ?? claims.sub);
    const email = String(
      claims.email ?? claims.preferred_username ?? "unknown",
    );
    const name = String(claims.name ?? email);

    // Gate login: user must have an active entitlement for the "Admin Console"
    // app in the managed users / role-assignments system.
    const [entitled] = await db
      .select({ userId: usersTable.id })
      .from(usersTable)
      .innerJoin(roleAssignmentsTable, eq(roleAssignmentsTable.userId, usersTable.id))
      .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
      .innerJoin(appsTable, eq(rolesTable.appId, appsTable.id))
      .where(
        and(
          eq(usersTable.entraObjectId, entraObjectId),
          eq(usersTable.status, "active"),
          eq(rolesTable.isEntitlement, true),
          eq(appsTable.name, "Admin Console"),
        ),
      )
      .limit(1);

    if (!entitled) {
      req.log.warn(
        { entraObjectId, email, name },
        "Authenticated user denied: no Admin Console entitlement",
      );
      await logAudit(
        "ACCESS_DENIED",
        entraObjectId,
        `${name} (${email}) denied Admin Console login — no entitlement assigned`,
        name,
      );
      // res.redirect("/?auth_error=not_authorized");
      res.redirect(`${FRONTEND_URL}/?auth_error=not_authorized`);
      return;
    }

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
      // res.redirect("/");
      if (embeddedLogin) {
          delete req.session.embeddedLogin;                  // added for embedded login
          res.redirect("/api/auth/embedded-complete");
          return;
      }
        res.redirect(FRONTEND_URL);
      } catch (err) {
        req.log.error({ err }, "Entra ID callback failed");
        // res.redirect("/?auth_error=callback_failed");
        res.redirect(`${FRONTEND_URL}/?auth_error=callback_failed`);
      }
});

// added embedded login Details 
router.get("/auth/embedded-complete", (req, res) => {
  const workspaceOrigin =
    process.env.WORKSPACE_FRONTEND_URL ?? "http://localhost:5176";

  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });

  res.status(200).type("html").send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Cache-Control"
          content="no-store, no-cache, must-revalidate"
        />
        <title>Authentication Complete</title>
      </head>
      <body>
        <script>
          console.log("ADMIN CONSOLE: embedded authentication complete");
          console.log("ADMIN CONSOLE: opener =", window.opener);
          console.log(
            "ADMIN CONSOLE: workspace origin =",
            ${JSON.stringify(workspaceOrigin)}
          );

          if (window.opener) {
            window.opener.postMessage(
              { type: "ADMIN_CONSOLE_AUTH_COMPLETE" },
              ${JSON.stringify(workspaceOrigin)}
            );

            console.log(
              "ADMIN CONSOLE: AUTH_COMPLETE message sent"
            );
          } else {
            console.error(
              "ADMIN CONSOLE: window.opener is NULL"
            );
          }

          setTimeout(() => {
            window.close();
          }, 500);
        </script>
      </body>
    </html>
  `);
});

router.get("/auth/me", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(req.session.user);
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
    // res.redirect("/");
    res.redirect(FRONTEND_URL);
  });
});

export default router;