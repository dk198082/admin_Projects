import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import rolesRouter from "./roles";
import appsResourcesRouter from "./appsResources";
import grantsRouter from "./grants";
import securityRouter from "./security";
import auditRouter from "./audit";
import syncRouter from "./sync";
import authRouter from "./auth";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireAuth);
router.use(usersRouter);
router.use(rolesRouter);
router.use(appsResourcesRouter);
router.use(grantsRouter);
router.use(securityRouter);
router.use(auditRouter);
router.use(syncRouter);

export default router;
