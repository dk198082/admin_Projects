import path from "node:path";
import fs from "node:fs";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { getDbPoolConfig } from "@workspace/db";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PgSession = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("Missing SESSION_SECRET environment variable");
}

const sessionPool = new pg.Pool(getDbPoolConfig());

// connect-pg-simple's createTableIfMissing reads a table.sql file that is not
// included in the esbuild bundle, so create the table ourselves before the
// server starts accepting requests (awaited in index.ts).
export async function ensureSessionTable(): Promise<void> {
  await sessionPool.query(
    `CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`,
  );
}

app.use(
  session({
    name: "workspace.sid",  // add for same logiin session 
    store: new PgSession({
      pool: sessionPool,
      tableName: "session",
      createTableIfMissing: false,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // maxAge: 8 * 60 * 60 * 1000,
      maxAge: 1 * 60 * 60 * 1000,  // one hour
    },
  }),
);

app.use("/api", router);

// --- AZURE DEPLOYMENT ---------------------------------------------------
// Optional single-service mode: if STATIC_ROOT_DIR is set, this API server
// serves BOTH frontends itself, so the whole workspace runs as ONE Azure App
// Service / Container Apps instance on ONE origin:
//   workspace-shell   -> site root "/"        (the digital workspace launcher)
//   admin-console     -> "/admin-console/"    (one of the launchable tiles)
// Same-origin deployment keeps the session cookie same-site and means the
// existing `cors({ origin: true, credentials: true })` above never actually
// needs to allow a cross-origin request in the first place. Unset in local
// dev (each Vite dev server serves its own app on its own port instead).
const staticRootDir = process.env.STATIC_ROOT_DIR;
if (staticRootDir) {
  const resolvedRoot = path.resolve(staticRootDir);

  // Mount admin-console's subpath FIRST so it's matched before
  // workspace-shell's root catch-all (workspace-shell owns "/" and would
  // otherwise shadow this path, since Express matches middleware in
  // registration order).
  const adminConsoleDir = path.join(resolvedRoot, "admin-console");
  const adminConsoleIndex = path.join(adminConsoleDir, "index.html");
  if (!fs.existsSync(adminConsoleIndex)) {
    throw new Error(
      `STATIC_ROOT_DIR is set to "${resolvedRoot}" but "admin-console/index.html" was not found there. ` +
        "Build both frontends first (see AZURE_DEPLOYMENT.md).",
    );
  }
  app.use("/admin-console", express.static(adminConsoleDir));
  app.get(/^\/admin-console(\/.*)?$/, (_req, res) => {
    res.sendFile(adminConsoleIndex);
  });

  // workspace-shell owns the site root and is the catch-all SPA fallback for
  // anything not matched above and not under /api.
  const shellDir = path.join(resolvedRoot, "workspace-shell");
  const shellIndex = path.join(shellDir, "index.html");
  if (!fs.existsSync(shellIndex)) {
    throw new Error(
      `STATIC_ROOT_DIR is set to "${resolvedRoot}" but "workspace-shell/index.html" was not found there. ` +
        "Build both frontends first (see AZURE_DEPLOYMENT.md).",
    );
  }
  app.use(express.static(shellDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(shellIndex);
  });
}

app.use((err: unknown, req: Request, res: Response, next: NextFunction): void => {
  if (res.headersSent) {
    next(err);
    return;
  }
  let pgCode: string | undefined;
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && typeof cursor === "object" && cursor !== null; depth++) {
    if ("code" in cursor && typeof (cursor as { code: unknown }).code === "string") {
      pgCode = (cursor as { code: string }).code;
      break;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  if (pgCode === "23503") {
    res.status(400).json({ error: "Referenced record does not exist" });
    return;
  }
  if (pgCode === "23505") {
    res.status(400).json({ error: "A record with these values already exists" });
    return;
  }
  req.log.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
