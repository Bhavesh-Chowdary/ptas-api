import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { getChangeLogs, getGlobalActivity } from "../controllers/changeLogController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getGlobalActivity); // Updated to global activity as default for dashboard
router.get("/raw", getChangeLogs); // Keep raw logs for debugging if needed

export default router;
