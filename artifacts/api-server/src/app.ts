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

const sessionPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

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
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);

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
