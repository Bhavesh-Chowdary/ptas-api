import express from "express";
import {
    getNotifications,
    markAsRead,
    markAllAsRead,
    pushReminder
} from "../controllers/notificationController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { permit } from "../middleware/roleMiddleware.js";

const router = express.Router();
router.use(authMiddleware);

router.get("/", getNotifications);
router.put("/:id/read", markAsRead);
router.put("/read-all", markAllAsRead);
router.post("/push", permit("admin", "Project Manager"), pushReminder);

export default router;
