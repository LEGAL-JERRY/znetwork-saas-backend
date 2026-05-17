import { Router } from 'express';
import { verifyPaymentAndIssueVoucher, redeemVoucher } from '../controllers/voucherController';

const router = Router();

// POST /api/voucher/verify-payment  — called after Paystack callback
router.post('/verify-payment', verifyPaymentAndIssueVoucher);

// POST /api/voucher/redeem  — called by MikroTik captive portal
router.post('/redeem', redeemVoucher);

export default router;
