import { Router, type IRouter } from "express";
import {
  SearchEntraUsersQueryParams,
  SearchEntraUsersResponse,
} from "@workspace/api-zod";
import { searchDirectoryUsers, GraphPermissionError } from "../lib/graph";

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

export default router;
