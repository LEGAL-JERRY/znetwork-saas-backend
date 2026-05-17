import { Request, Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../middleware/auth';

// ============================================================
// GET /api/tenant/:slug  (PUBLIC - called by login page frontend)
// Returns tenant config + plans for rendering the portal
// ============================================================
export const getTenantBySlug = async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params;

  try {
    const tenantResult = await pool.query(
      `SELECT 
        id, slug, enterprise_name, logo_url, support_whatsapp,
        paystack_public_key, bank_account_name, is_active
       FROM tenants WHERE slug = $1`,
      [slug]
    );

    if (tenantResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Portal not found' });
      return;
    }

    const tenant = tenantResult.rows[0];

    if (!tenant.is_active) {
      res.status(403).json({ success: false, message: 'This portal is currently inactive' });
      return;
    }

    const plansResult = await pool.query(
      `SELECT id, plan_name, price, duration_hours, speed_limit, devices_allowed, is_popular
       FROM tenant_plans
       WHERE tenant_id = $1 AND is_active = TRUE
       ORDER BY display_order ASC`,
      [tenant.id]
    );

    res.json({
      success: true,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        enterprise_name: tenant.enterprise_name,
        logo_url: tenant.logo_url,
        support_whatsapp: tenant.support_whatsapp,
        paystack_public_key: tenant.paystack_public_key,
      },
      plans: plansResult.rows,
    });
  } catch (err) {
    console.error('Get tenant error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// GET /api/owner/portal  (PROTECTED - dashboard data)
// Returns full tenant details for the owner dashboard
// ============================================================
export const getOwnerPortal = async (req: AuthRequest, res: Response): Promise<void> => {
  const ownerId = req.ownerId;

  try {
    const result = await pool.query(
      `SELECT t.*, 
        (SELECT COUNT(*) FROM vouchers v WHERE v.tenant_id = t.id) as total_vouchers,
        (SELECT COUNT(*) FROM vouchers v WHERE v.tenant_id = t.id AND v.is_used = TRUE) as used_vouchers,
        (SELECT COALESCE(SUM(amount_paid),0) FROM vouchers v WHERE v.tenant_id = t.id) as total_revenue
       FROM tenants t WHERE t.owner_id = $1`,
      [ownerId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'No portal found. Please set one up.' });
      return;
    }

    const plansResult = await pool.query(
      `SELECT * FROM tenant_plans WHERE tenant_id = $1 ORDER BY display_order`,
      [result.rows[0].id]
    );

    res.json({
      success: true,
      portal: result.rows[0],
      plans: plansResult.rows,
    });
  } catch (err) {
    console.error('Get owner portal error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// PUT /api/owner/portal  (PROTECTED - update portal settings)
// ============================================================
export const updatePortal = async (req: AuthRequest, res: Response): Promise<void> => {
  const ownerId = req.ownerId;
  const {
    enterprise_name, support_whatsapp,
    bank_account_number, bank_name, bank_account_name,
    paystack_public_key, paystack_secret_key, logo_url,
  } = req.body;

  try {
    await pool.query(
      `UPDATE tenants SET
        enterprise_name = COALESCE($1, enterprise_name),
        support_whatsapp = COALESCE($2, support_whatsapp),
        bank_account_number = COALESCE($3, bank_account_number),
        bank_name = COALESCE($4, bank_name),
        bank_account_name = COALESCE($5, bank_account_name),
        paystack_public_key = COALESCE($6, paystack_public_key),
        paystack_secret_key = COALESCE($7, paystack_secret_key),
        logo_url = COALESCE($8, logo_url),
        updated_at = NOW()
       WHERE owner_id = $9`,
      [
        enterprise_name, support_whatsapp,
        bank_account_number, bank_name, bank_account_name,
        paystack_public_key, paystack_secret_key, logo_url,
        ownerId,
      ]
    );

    res.json({ success: true, message: 'Portal updated successfully' });
  } catch (err) {
    console.error('Update portal error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// PUT /api/owner/plans  (PROTECTED - update plans)
// ============================================================
export const updatePlans = async (req: AuthRequest, res: Response): Promise<void> => {
  const ownerId = req.ownerId;
  const { plans } = req.body;

  if (!plans || plans.length > 6) {
    res.status(400).json({ success: false, message: 'Send 1-6 plans' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tenantResult = await client.query(
      'SELECT id FROM tenants WHERE owner_id = $1', [ownerId]
    );

    if (tenantResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Portal not found' });
      return;
    }

    const tenantId = tenantResult.rows[0].id;

    // Delete existing plans and reinsert
    await client.query('DELETE FROM tenant_plans WHERE tenant_id = $1', [tenantId]);

    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      await client.query(
        `INSERT INTO tenant_plans (tenant_id, plan_name, price, duration_hours, speed_limit, devices_allowed, is_popular, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          tenantId, plan.plan_name, plan.price, plan.duration_hours,
          plan.speed_limit || 'Unlimited', plan.devices_allowed || 1,
          plan.is_popular || false, i + 1,
        ]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Plans updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update plans error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
};
