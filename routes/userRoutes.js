import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import { getUsers, getAssignableUsers, getSupervisors, savePlayerId } from '../controllers/userController.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', permit('admin', 'Project Manager'), getUsers);
router.get('/assignable', permit('admin', 'Project Manager', 'developer', 'qa'), getAssignableUsers);
router.get('/supervisors', permit('admin', 'Project Manager'), getSupervisors);
router.post('/save-player-id', savePlayerId);

export default router;