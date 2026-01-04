import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import {
  createTimesheet,
  getTimesheets,
  approveTimesheet,
  getWeeklySummary,
  getGeneratedTimesheetPreview as getTimesheetPreview,
  saveTimesheet,
  getTimesheetHistory,
  getTimesheetById
} from '../controllers/timesheetController.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', createTimesheet); // employee
router.get('/', getTimesheets); // employee/pm
router.patch('/:id/approve', permit('Project Manager', 'admin'), approveTimesheet);
router.get('/summary/weekly', permit('Project Manager', 'admin'), getWeeklySummary);

// Generated Timesheets
router.get('/preview', permit('Project Manager', 'admin'), getTimesheetPreview);
router.post('/save', permit('Project Manager', 'admin'), saveTimesheet);
router.get('/history', getTimesheetHistory);
router.get('/:id/generated', getTimesheetById);
export default router;
