import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import { getUsers, getAssignableUsers } from '../controllers/userController.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', permit('admin', 'Project Manager'), getUsers);
router.get('/assignable', permit('admin', 'Project Manager', 'developer', 'qa'), getAssignableUsers);

export default router;