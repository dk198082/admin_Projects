import { Router, type IRouter } from "express";
import {
  buildPermissionMatrixBuffer,
  PERMISSION_MATRIX_FILENAME,
} from "@workspace/permission-matrix";

const router: IRouter = Router();

router.get("/permission-matrix/export", async (_req, res): Promise<void> => {
  const buffer = await buildPermissionMatrixBuffer();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${PERMISSION_MATRIX_FILENAME}"`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
});

export default router;
