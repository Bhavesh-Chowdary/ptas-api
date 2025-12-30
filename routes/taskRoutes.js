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

router.post('/', permit('admin', 'Project Manager', 'developer'), createTask);
router.get('/', getTasks);
router.get('/:id', getTaskById);
router.put('/:id', permit('admin', 'Project Manager', 'developer', 'qa'), updateTask);
router.patch('/:id', permit('admin', 'Project Manager', 'developer', 'qa'), updateTask);
router.delete('/:id', permit('admin', 'Project Manager'), deleteTask);

export default router;
