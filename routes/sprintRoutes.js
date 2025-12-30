import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import {
  createSprint,
  getSprints,
  getSprintById,
  updateSprint,
  deleteSprint
} from '../controllers/sprintController.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', permit('admin', 'Project Manager'), createSprint);
router.get('/', getSprints);
router.get('/id', getSprintById);
router.patch('/id', permit('admin', 'Project Manager'), updateSprint);
router.delete('/id', permit('admin', 'Project Manager'), deleteSprint);
export default router;
