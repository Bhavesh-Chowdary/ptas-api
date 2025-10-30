import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject
} from '../controllers/projectController.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', permit('admin', 'pm'), createProject);
router.get('/', getProjects);
router.get('/:id', getProjectById);
router.patch('/:id', permit('admin', 'pm'), updateProject);
router.delete('/:id', permit('admin'), deleteProject);

export default router;
