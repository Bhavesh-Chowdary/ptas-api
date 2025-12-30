import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import { upload } from '../middleware/upload.js';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  downloadDocument,
  getProjectSummary
} from '../controllers/projectController.js';
import { getProjectActivity } from '../controllers/changeLogController.js';

const router = express.Router();
router.use(authMiddleware);

router.post("/",upload.single("document"),permit('admin', 'Project Manager'),createProject);
router.get('/', getProjects);
router.get('/:id', getProjectById);
router.get('/:id/document', downloadDocument);
router.patch('/id', permit('admin', 'Project Manager'), updateProject);
router.delete('/id', permit('admin'), deleteProject);
router.get("/:id/summary", getProjectSummary);
router.get("/:id/activity", getProjectActivity);

export default router;
