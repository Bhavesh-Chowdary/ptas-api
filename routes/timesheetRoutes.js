import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import {
  createTimesheet,
  getTimesheets,
  approveTimesheet,
  getWeeklySummary
} from '../controllers/timesheetController.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', createTimesheet); // employee
router.get('/', getTimesheets); // employee/pm
router.patch('/:id/approve', permit('pm', 'admin'), approveTimesheet); // pm/admin
router.get('/summary/weekly', permit('pm', 'admin'), getWeeklySummary); // pm/admin

export default router;
