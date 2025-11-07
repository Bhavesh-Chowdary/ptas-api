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

// File upload setup
const upload = multer({ dest: 'uploads/' });

router.use(authMiddleware);

router.post('/', permit('admin', 'pm'), upload.single('document'), createProject);
router.get('/', getProjects);
router.get('/:id', getProjectById);
router.get('/:id/document', downloadDocument);
router.patch('/:id', permit('admin', 'pm'), updateProject);
router.delete('/:id', permit('admin'), deleteProject);

export default router;
