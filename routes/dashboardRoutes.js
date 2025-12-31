import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import {
    getActiveProjects,
    getActiveSprints,
    getUpcomingDeadlines,
    getTimelineData,
    getWeeklyStats
} from "../controllers/dashboardController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/active-projects", getActiveProjects);
router.get("/active-sprints", getActiveSprints);
router.get("/upcoming-deadlines", getUpcomingDeadlines);
router.get("/timeline", getTimelineData);
router.get("/weekly-stats", getWeeklyStats);

export default router;
