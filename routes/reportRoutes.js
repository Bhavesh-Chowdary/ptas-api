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
router.get('/project-overview', permit('Project Manager', 'admin'), getProjectOverview);
router.get('/sprint-summary', permit('Project Manager', 'admin'), getSprintSummary);
router.get('/resource-allocation', permit('Project Manager', 'admin'), getResourceAllocation);
router.get('/timesheet-compliance', permit('Project Manager', 'admin'), getTimesheetCompliance);

export default router;
