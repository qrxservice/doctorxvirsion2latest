import { Router, type IRouter } from "express";
import demoAuthRouter from "./demo-auth";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(demoAuthRouter);

export default router;
