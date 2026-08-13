import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  SearchWorkOrdersQueryParams,
  SearchWorkOrdersResponse,
  PreviewWorkOrderPurgeBody,
  PreviewWorkOrderPurgeResponse,
  ExecuteWorkOrderPurgeBody,
  ExecuteWorkOrderPurgeResponse,
} from "@workspace/api-zod";
import { purgeWorkOrder } from "../lib/purgeWorkOrder";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

const DATA_AREA_ID = "TOUS";

router.get("/work-order-purge/search", async (req, res): Promise<void> => {
  const query = SearchWorkOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const q = query.data.q.trim();
  if (!q) {
    res.json([]);
    return;
  }
  const result = await pool.query(
    `SELECT productionordernumber, productionordername, itemnumber,
            productionorderstatus, scheduleddate, dataareaid
       FROM d365fo.prodproductionorderheaderstaging
      WHERE dataareaid = $2
        AND productionordernumber ILIKE $1
      ORDER BY productionordernumber
      LIMIT 50`,
    [`%${q}%`, DATA_AREA_ID],
  );
  res.json(
    SearchWorkOrdersResponse.parse(
      result.rows.map((r) => ({
        orderNumber: String(r.productionordernumber),
        name: String(r.productionordername ?? ""),
        itemNumber: String(r.itemnumber ?? ""),
        status: String(r.productionorderstatus ?? ""),
        scheduledDate:
          r.scheduleddate == null
            ? null
            : r.scheduleddate instanceof Date
              ? r.scheduleddate.toISOString()
              : String(r.scheduleddate),
        dataAreaId: String(r.dataareaid ?? ""),
      })),
    ),
  );
});

router.post("/work-order-purge/preview", async (req, res): Promise<void> => {
  const body = PreviewWorkOrderPurgeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const client = await pool.connect();
  try {
    const result = await purgeWorkOrder(client, body.data.orderNumbers, {
      dryRun: true,
      dataAreaId: DATA_AREA_ID,
    });
    res.json(PreviewWorkOrderPurgeResponse.parse(result));
  } finally {
    client.release();
  }
});

router.post("/work-order-purge/execute", async (req, res): Promise<void> => {
  const body = ExecuteWorkOrderPurgeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const client = await pool.connect();
  try {
    const result = await purgeWorkOrder(client, body.data.orderNumbers, {
      dryRun: false,
      dataAreaId: DATA_AREA_ID,
    });
    // The purge is already committed at this point — never let an audit-log
    // failure turn a successful purge into a 500 (the client would wrongly
    // conclude nothing was deleted).
    try {
      await logAudit(
        "purge",
        "Work Order",
        `Purged ${result.totalRows} staging row(s) for order(s) ${result.orderNumbers.join(", ")} (company ${result.dataAreaId})`,
        req.session.user?.name,
      );
    } catch (err) {
      req.log.error({ err }, "Work order purge succeeded but audit log write failed");
    }
    res.json(ExecuteWorkOrderPurgeResponse.parse(result));
  } finally {
    client.release();
  }
});

export default router;
