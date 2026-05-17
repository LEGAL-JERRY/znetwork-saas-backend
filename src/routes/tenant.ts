import { Router } from 'express';
import { getTenantBySlug, getOwnerPortal, updatePortal, updatePlans } from '../controllers/tenantController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// PUBLIC — called by the frontend portal page
// GET /api/tenant/:slug
router.get('/:slug', getTenantBySlug);

// PROTECTED — owner dashboard routes
// GET /api/owner/portal
router.get('/owner/portal', authMiddleware, getOwnerPortal);

// PUT /api/owner/portal
router.put('/owner/portal', authMiddleware, updatePortal);

// PUT /api/owner/plans
router.put('/owner/plans', authMiddleware, updatePlans);

export default router;
