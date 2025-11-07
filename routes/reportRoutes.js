import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import {
  getProjectOverview,
  getSprintSummary,
  getResourceAllocation,
  getTimesheetCompliance
} from '../controllers/reportController.js';

const router = express.Router();

router.use(authMiddleware);

// All report routes are restricted to PM/Admin
router.get('/project-overview', permit('pm', 'admin'), getProjectOverview);
router.get('/sprint-summary', permit('pm', 'admin'), getSprintSummary);
router.get('/resource-allocation', permit('pm', 'admin'), getResourceAllocation);
router.get('/timesheet-compliance', permit('pm', 'admin'), getTimesheetCompliance);

export default router;
