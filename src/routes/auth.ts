import { Router } from 'express';
import { register, login, setupPortal } from '../controllers/authController';

const router = Router();

// POST /api/auth/register  — create ISP owner account
router.post('/register', register);

// POST /api/auth/login  — login ISP owner
router.post('/login', login);

// POST /api/auth/setup-portal  — after register, set up ISP details + plans
router.post('/setup-portal', setupPortal);

export default router;
