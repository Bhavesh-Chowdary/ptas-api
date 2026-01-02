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
  getProjectSummary,
  getMyProjects,
  getProjectMembers,
  getProjectHierarchy
} from '../controllers/projectController.js';
import { getProjectActivity } from '../controllers/changeLogController.js';

const router = express.Router();
router.use(authMiddleware);

router.post("/", upload.single("document"), permit('admin', 'Project Manager'), createProject);
router.get('/', getProjects);
router.get("/my", getMyProjects); // Static route BEFORE dynamic /:id
router.get('/:id', getProjectById);
router.get('/:id/document', downloadDocument);
router.patch('/:id', upload.single("document"), permit('admin', 'Project Manager'), updateProject); // Fixed /:id
router.delete('/:id', permit('admin'), deleteProject); // Fixed /:id
router.get("/:id/summary", getProjectSummary);
router.get("/:id/activity", getProjectActivity);
router.get("/:id/members", authMiddleware, getProjectMembers);
router.get("/:id/hierarchy", getProjectHierarchy);

export default router;
