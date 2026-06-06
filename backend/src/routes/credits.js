import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ─── Razorpay stubs ────────────────────────────────────────────────────────
// These routes are designed and ready for Razorpay integration.
// When you have Razorpay keys, install: npm install razorpay
// Then uncomment the Razorpay code below.

const PACKAGES = [
  { id: 'p5',  credits: 5,  amount_paise: 2000,  label: '₹20 → 5 credits'  },
  { id: 'p15', credits: 15, amount_paise: 5000,  label: '₹50 → 15 credits' },
  { id: 'p35', credits: 35, amount_paise: 10000, label: '₹100 → 35 credits' },
];

// GET /api/credits/packages — available purchase packages
router.get('/packages', (_req, res) => {
  res.json(PACKAGES);
});

// POST /api/credits/purchase-intent
// Creates a Razorpay order (stub — returns placeholder until Razorpay is configured)
router.post('/purchase-intent', requireAuth, async (req, res) => {
  const { package_id } = req.body;
  const pkg = PACKAGES.find(p => p.id === package_id);
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });

  // TODO: Uncomment when Razorpay keys are available
  //
  // import Razorpay from 'razorpay';
  // const razorpay = new Razorpay({
  //   key_id: process.env.RAZORPAY_KEY_ID,
  //   key_secret: process.env.RAZORPAY_KEY_SECRET,
  // });
  // const order = await razorpay.orders.create({
  //   amount: pkg.amount_paise,
  //   currency: 'INR',
  //   receipt: `noteblock_${Date.now()}`,
  //   notes: { user_id: req.user.id, credits: pkg.credits },
  // });
  // return res.json({ order_id: order.id, amount: order.amount, key: process.env.RAZORPAY_KEY_ID });

  res.status(503).json({
    error: 'payment_not_configured',
    message: 'Razorpay not yet configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env.',
  });
});

// POST /api/credits/verify
// Verifies Razorpay payment signature and grants credits
router.post('/verify', requireAuth, async (req, res) => {
  // TODO: Uncomment when Razorpay keys are available
  //
  // const { razorpay_order_id, razorpay_payment_id, razorpay_signature, credits } = req.body;
  // const crypto = await import('crypto');
  // const expected = crypto
  //   .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
  //   .update(`${razorpay_order_id}|${razorpay_payment_id}`)
  //   .digest('hex');
  //
  // if (expected !== razorpay_signature) {
  //   return res.status(400).json({ error: 'Invalid signature' });
  // }
  //
  // await supabaseAdmin.from('users')
  //   .update({ credits_balance: supabaseAdmin.rpc('credits_balance + ' + credits) })
  //   .eq('id', req.user.id);
  //
  // await supabaseAdmin.from('credit_transactions').insert({
  //   user_id: req.user.id,
  //   amount: credits,
  //   type: 'purchase',
  //   razorpay_order_id,
  // });
  //
  // return res.json({ success: true });

  res.status(503).json({ error: 'payment_not_configured' });
});

export default router;
