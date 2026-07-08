import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
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
