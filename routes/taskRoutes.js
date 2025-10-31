import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask
} from '../controllers/taskController.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', permit('admin', 'pm'), createTask);
router.get('/', getTasks);
router.get('/:id', getTaskById);
router.patch('/:id', permit('admin', 'pm', 'developer', 'qa'), updateTask);
router.delete('/:id', permit('admin', 'pm'), deleteTask);

export default router;
