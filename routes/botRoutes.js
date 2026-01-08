import express from 'express';
import { askBot } from '../controllers/botController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Protected route so only logged in users can chat
router.post('/ask', authMiddleware, askBot);

export default router;
