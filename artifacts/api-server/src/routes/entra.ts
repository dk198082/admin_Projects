import { Router, type IRouter } from "express";
import {
  SearchEntraUsersQueryParams,
  SearchEntraUsersResponse,
  ListEntraSignInsQueryParams,
  ListEntraSignInsResponse,
} from "@workspace/api-zod";
import { searchDirectoryUsers, getSignInLogs, GraphPermissionError } from "../lib/graph";

const router: IRouter = Router();

router.get("/entra/users", async (req, res): Promise<void> => {
  const query = SearchEntraUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const trimmed = query.data.query.trim();
  if (trimmed.length < 2) {
    res.status(400).json({ error: "Search query must be at least 2 characters" });
    return;
  }
  try {
    const users = await searchDirectoryUsers(trimmed);
    res.json(
      SearchEntraUsersResponse.parse(
        users.map((u) => ({
          objectId: u.id,
          displayName: u.displayName ?? u.userPrincipalName ?? "",
          email: u.mail ?? u.userPrincipalName ?? "",
          accountEnabled: u.accountEnabled ?? true,
        })),
      ),
    );
  } catch (err) {
    if (err instanceof GraphPermissionError) {
      req.log.warn({ err }, "Graph permission missing for directory search");
      res.status(502).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Entra directory search failed");
    res.status(502).json({ error: "Failed to search the Azure Entra directory" });
  }
});

router.get("/entra/signins", async (req, res): Promise<void> => {
  const query = ListEntraSignInsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const app = query.data.app?.trim() || undefined;
  try {
    const signIns = await getSignInLogs(app);
    res.json(
      ListEntraSignInsResponse.parse(
        signIns.map((s) => ({
          id: s.id,
          userDisplayName: s.userDisplayName ?? "",
          userPrincipalName: s.userPrincipalName ?? "",
          appDisplayName: s.appDisplayName ?? "",
          createdDateTime: s.createdDateTime,
          success: (s.status?.errorCode ?? 0) === 0,
          failureReason:
            (s.status?.errorCode ?? 0) === 0 ? null : s.status?.failureReason ?? null,
          ipAddress: s.ipAddress ?? null,
        })),
      ),
    );
  } catch (err) {
    if (err instanceof GraphPermissionError) {
      req.log.warn({ err }, "Graph permission missing for sign-in logs");
      res.status(502).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Entra sign-in log query failed");
    res.status(502).json({ error: "Failed to fetch Entra sign-in logs" });
  }
});

export default router;
