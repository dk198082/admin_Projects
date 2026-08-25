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
// Optional single-service mode: if STATIC_DIR points at the built frontend
// (artifacts/admin-console/dist/public), this API server also serves it, so
// the whole app runs as ONE Azure App Service / Container Apps instance on
// ONE origin. That keeps the session cookie same-site/same-origin and avoids
// needing a second Azure resource (the existing `cors({ origin: true,
// credentials: true })` above already reflects any origin, but same-origin
// deployment means the browser never issues a cross-origin request at all).
// Unset in local dev (the Vite dev server serves the frontend on its own
// port instead) and set by ./Dockerfile / AZURE_DEPLOYMENT.md in production.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const resolvedStaticDir = path.resolve(staticDir);
  if (!fs.existsSync(path.join(resolvedStaticDir, "index.html"))) {
    throw new Error(
      `STATIC_DIR is set to "${resolvedStaticDir}" but no index.html was found there. ` +
        "Build the frontend first (see AZURE_DEPLOYMENT.md).",
    );
  }
  app.use(express.static(resolvedStaticDir));
  // SPA fallback: any non-API, non-file GET request returns index.html so
  // client-side routing can handle the path. Registered after "/api" so API
  // routes/404s above are never shadowed by this.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
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
