import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import {
  createModule,
  getModules,
  getModuleById,
  updateModule,
  deleteModule
} from '../controllers/moduleController.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', permit('admin', 'Project Manager'), createModule);
router.get('/', getModules);
router.get('/:id', getModuleById);
router.patch('/:id', permit('admin', 'Project Manager'), updateModule);
router.delete('/:id', permit('admin', 'Project Manager'), deleteModule);
export default router;
