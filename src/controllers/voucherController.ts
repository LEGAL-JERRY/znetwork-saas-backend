import { Request, Response } from 'express';
import pool from '../config/database';

// Generate a random 8-character alphanumeric voucher code
const generateVoucherCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

// ============================================================
// POST /api/voucher/verify-payment
// Called after Paystack payment succeeds
// Body: { reference, tenant_id, plan_id, customer_phone, amount_paid }
// ============================================================
export const verifyPaymentAndIssueVoucher = async (req: Request, res: Response): Promise<void> => {
  const { reference, tenant_id, plan_id, customer_phone, amount_paid } = req.body;

  if (!reference || !tenant_id || !plan_id || !amount_paid) {
    res.status(400).json({ success: false, message: 'Missing required fields' });
    return;
  }

  try {
    // Get tenant's Paystack secret key
    const tenantResult = await pool.query(
      'SELECT paystack_secret_key FROM tenants WHERE id = $1 AND is_active = TRUE',
      [tenant_id]
    );

    if (tenantResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Tenant not found' });
      return;
    }

    const paystackSecret = tenantResult.rows[0].paystack_secret_key;

    // Verify with Paystack
    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });

    const paystackData = await paystackRes.json() as {
      status: boolean;
      data: { status: string; amount: number };
    };

    if (!paystackData.status || paystackData.data.status !== 'success') {
      res.status(400).json({ success: false, message: 'Payment verification failed' });
      return;
    }

    // Verify amount matches (Paystack returns amount in kobo)
    const paidKobo = paystackData.data.amount;
    const expectedKobo = amount_paid * 100;

    if (paidKobo < expectedKobo) {
      res.status(400).json({ success: false, message: 'Amount mismatch' });
      return;
    }

    // Get plan details for expiry calculation
    const planResult = await pool.query(
      'SELECT * FROM tenant_plans WHERE id = $1 AND tenant_id = $2',
      [plan_id, tenant_id]
    );

    if (planResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Plan not found' });
      return;
    }

    const plan = planResult.rows[0];

    // Check if reference already used (prevent double voucher)
    const existing = await pool.query(
      'SELECT id FROM vouchers WHERE paystack_reference = $1',
      [reference]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ success: false, message: 'Payment already processed' });
      return;
    }

    // Generate unique voucher code
    let code = generateVoucherCode();
    let attempts = 0;
    while (attempts < 10) {
      const codeCheck = await pool.query('SELECT id FROM vouchers WHERE code = $1', [code]);
      if (codeCheck.rows.length === 0) break;
      code = generateVoucherCode();
      attempts++;
    }

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + plan.duration_hours);

    // Insert voucher
    await pool.query(
      `INSERT INTO vouchers (tenant_id, plan_id, code, customer_phone, paystack_reference, amount_paid, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenant_id, plan_id, code, customer_phone || null, reference, amount_paid, expiresAt]
    );

    res.json({
      success: true,
      voucher: {
        code,
        plan_name: plan.plan_name,
        duration_hours: plan.duration_hours,
        expires_at: expiresAt,
        amount_paid,
      },
    });
  } catch (err) {
    console.error('Voucher error:', err);
    res.status(500).json({ success: false, message: 'Server error during voucher generation' });
  }
};

// ============================================================
// POST /api/voucher/redeem
// MikroTik captive portal calls this to validate a voucher code
// Body: { code, tenant_id }
// ============================================================
export const redeemVoucher = async (req: Request, res: Response): Promise<void> => {
  const { code, tenant_id } = req.body;

  if (!code || !tenant_id) {
    res.status(400).json({ success: false, message: 'Code and tenant_id required' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT v.*, tp.plan_name, tp.duration_hours, tp.speed_limit
       FROM vouchers v
       JOIN tenant_plans tp ON tp.id = v.plan_id
       WHERE v.code = $1 AND v.tenant_id = $2`,
      [code.toUpperCase(), tenant_id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Invalid voucher code' });
      return;
    }

    const voucher = result.rows[0];

    if (voucher.is_used) {
      res.status(400).json({ success: false, message: 'Voucher already used' });
      return;
    }

    if (new Date() > new Date(voucher.expires_at)) {
      res.status(400).json({ success: false, message: 'Voucher has expired' });
      return;
    }

    // Mark as used
    await pool.query(
      'UPDATE vouchers SET is_used = TRUE, used_at = NOW() WHERE id = $1',
      [voucher.id]
    );

    res.json({
      success: true,
      message: 'Voucher valid — access granted',
      access: {
        plan_name: voucher.plan_name,
        duration_hours: voucher.duration_hours,
        speed_limit: voucher.speed_limit,
      },
    });
  } catch (err) {
    console.error('Redeem error:', err);
    res.status(500).json({ success: false, message: 'Server error during redemption' });
  }
};
