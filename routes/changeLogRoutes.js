import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
//import { permit } from "../middleware/roleMiddleware.js";
import { getChangeLogs } from "../controllers/changeLogController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getChangeLogs);

export default router;
