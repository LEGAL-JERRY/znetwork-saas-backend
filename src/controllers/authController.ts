import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

// Helper: generate a URL-safe slug from enterprise name
const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
};

// ============================================================
// POST /api/auth/register
// Step 1: Create ISP owner account
// ============================================================
export const register = async (req: Request, res: Response): Promise<void> => {
  const { email, password, full_name, phone } = req.body;

  if (!email || !password || !full_name) {
    res.status(400).json({ success: false, message: 'Email, password and full name are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    return;
  }

  try {
    // Check if email already exists
    const existing = await pool.query('SELECT id FROM isp_owners WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ success: false, message: 'Email already registered' });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    const ownerId = uuidv4();

    await pool.query(
      `INSERT INTO isp_owners (id, email, password_hash, full_name, phone, is_verified)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [ownerId, email.toLowerCase(), password_hash, full_name, phone || null]
    );

    res.status(201).json({
      success: true,
      message: 'Account created. Now set up your ISP portal.',
      ownerId,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
};

// ============================================================
// POST /api/auth/login
// ============================================================
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, message: 'Email and password required' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT o.*, t.id as tenant_id, t.slug
       FROM isp_owners o
       LEFT JOIN tenants t ON t.owner_id = o.id
       WHERE o.email = $1 AND o.is_active = TRUE`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const owner = result.rows[0];
    const isValid = await bcrypt.compare(password, owner.password_hash);

    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign(
      { ownerId: owner.id, tenantId: owner.tenant_id || null },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      owner: {
        id: owner.id,
        email: owner.email,
        full_name: owner.full_name,
        has_portal: !!owner.tenant_id,
        portal_slug: owner.slug || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
};

// ============================================================
// POST /api/auth/setup-portal
// Step 2: After registering, owner sets up their ISP portal
// Body: enterprise_name, plans[6], bank_account_number, bank_name,
//       bank_account_name, paystack_public_key, paystack_secret_key,
//       support_whatsapp
// ============================================================
export const setupPortal = async (req: Request, res: Response): Promise<void> => {
  const {
    owner_id,
    enterprise_name,
    plans,
    bank_account_number,
    bank_name,
    bank_account_name,
    paystack_public_key,
    paystack_secret_key,
    support_whatsapp,
  } = req.body;

  if (!owner_id || !enterprise_name || !plans || plans.length < 1) {
    res.status(400).json({ success: false, message: 'Enterprise name and at least one plan are required' });
    return;
  }

  if (plans.length > 6) {
    res.status(400).json({ success: false, message: 'Maximum 6 plans allowed' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate unique slug
    let slug = generateSlug(enterprise_name);
    const slugCheck = await client.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    if (slugCheck.rows.length > 0) {
      slug = `${slug}-${Date.now().toString().slice(-4)}`;
    }

    const tenantId = uuidv4();

    // Insert tenant
    await client.query(
      `INSERT INTO tenants (
        id, owner_id, slug, enterprise_name, support_whatsapp,
        paystack_public_key, paystack_secret_key,
        bank_account_number, bank_name, bank_account_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenantId, owner_id, slug, enterprise_name, support_whatsapp || null,
        paystack_public_key || null, paystack_secret_key || null,
        bank_account_number || null, bank_name || null, bank_account_name || null,
      ]
    );

    // Insert plans
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      await client.query(
        `INSERT INTO tenant_plans (
          id, tenant_id, plan_name, price, duration_hours,
          speed_limit, devices_allowed, is_popular, display_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          uuidv4(), tenantId, plan.plan_name, plan.price, plan.duration_hours,
          plan.speed_limit || 'Unlimited', plan.devices_allowed || 1,
          plan.is_popular || false, i + 1,
        ]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Portal created successfully!',
      portal: {
        slug,
        tenant_id: tenantId,
        portal_url: `/portal/${slug}`,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Setup portal error:', err);
    res.status(500).json({ success: false, message: 'Server error during portal setup' });
  } finally {
    client.release();
  }
};
