import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { permit } from '../middleware/roleMiddleware.js';
import{ getUsers } from '../controllers/userController.js';

const router = express.Router();
router.get('/',getUsers);
export default router;