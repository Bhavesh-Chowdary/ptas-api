import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  downloadDocument
} from '../controllers/projectController.js';

const router = express.Router();

const upload = multer({ dest: 'uploads/' });

router.use(authMiddleware);

router.post('/', permit('admin', 'Project Manager'), upload.single('document'), createProject);
router.get('/', getProjects);
router.get('/id', getProjectById);
router.get('/:id/document', downloadDocument);
router.patch('/id', permit('admin', 'Project Manager'), updateProject);
router.delete('/id', permit('admin'), deleteProject);

export default router;
