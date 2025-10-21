const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate, authorizeUser } = require('../middleware/authMiddleware');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Add your secret key

// Get Subscription Status
router.get('/landlord/:uid/subscription', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;
    connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT * FROM subscriptions WHERE uid = ? ORDER BY createdAt DESC LIMIT 1',
      [uid]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        subscription: null,
        isActive: false,
      });
    }

    const subscription = rows[0];
    const now = new Date();
    const expiresAt = new Date(subscription.expiresAt);
    const isActive = subscription.status === 'active' && expiresAt > now;

    subscription.amount = parseFloat(subscription.amount);

    res.status(200).json({
      success: true,
      subscription: subscription,
      isActive: isActive,
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: error.message || 'Failed to get subscription' });
  } finally {
    if (connection) connection.release();
  }
});

// Check if user can create a post
router.get('/landlord/:uid/subscription/can-post', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    connection = await pool.getConnection();
    
    const [subscriptionRows] = await connection.query(
      'SELECT * FROM subscriptions WHERE uid = ? AND status = "active" ORDER BY createdAt DESC LIMIT 1',
      [uid]
    );

    if (subscriptionRows.length === 0) {
      return res.status(200).json({
        success: true,
        canPost: false,
        reason: 'no_subscription',
        message: 'No active subscription found',
      });
    }

    const subscription = subscriptionRows[0];
    const now = new Date();
    const expiresAt = new Date(subscription.expiresAt);

    if (expiresAt <= now) {
      await connection.query(
        'UPDATE subscriptions SET status = "expired" WHERE id = ?',
        [subscription.id]
      );

      return res.status(200).json({
        success: true,
        canPost: false,
        reason: 'subscription_expired',
        message: 'Your subscription has expired',
      });
    }

    if (subscription.planType === 'per_post') {
      const [postRows] = await connection.query(
        'SELECT COUNT(*) as postCount FROM room_postings WHERE uid = ? AND subscriptionId = ?',
        [uid, subscription.id]
      );

      const postCount = postRows[0].postCount;

      if (postCount >= 1) {
        return res.status(200).json({
          success: true,
          canPost: false,
          reason: 'per_post_used',
          message: 'You have already used your single post. Please subscribe again.',
        });
      }
    }

    res.status(200).json({
      success: true,
      canPost: true,
      subscription: {
        id: subscription.id,
        planType: subscription.planType,
        expiresAt: subscription.expiresAt,
      },
      message: 'You can create a post',
    });
  } catch (error) {
    console.error('Check can post error:', error);
    res.status(500).json({ error: error.message || 'Failed to check post eligibility' });
  } finally {
    if (connection) connection.release();
  }
});

// Create Payment Intent (Step 1 - Called before payment)
router.post('/landlord/:uid/create-payment-intent', authenticate, authorizeUser, async (req, res) => {
  try {
    const { uid } = req.params;
    const { planType } = req.body;

    if (!planType || !['per_post', 'monthly', 'yearly'].includes(planType)) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    // Calculate amount based on plan
    let amount;
    switch (planType) {
      case 'per_post':
        amount = 200; // $2.00 in cents
        break;
      case 'monthly':
        amount = 1000; // $10.00 in cents
        break;
      case 'yearly':
        amount = 8000; // $80.00 in cents
        break;
    }

    // Create a PaymentIntent with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      metadata: {
        uid: uid,
        planType: planType,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: error.message || 'Failed to create payment intent' });
  }
});

// Confirm Subscription (Step 2 - Called after successful payment)
router.post('/landlord/:uid/subscription', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;
    const { planType, paymentIntentId } = req.body;

    if (!planType || !['per_post', 'monthly', 'yearly'].includes(planType)) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID is required' });
    }

    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Verify the payment matches the user and plan
    if (paymentIntent.metadata.uid !== uid || paymentIntent.metadata.planType !== planType) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Calculate expiration
    let amount, expiresAt;
    const now = new Date();

    switch (planType) {
      case 'per_post':
        amount = 2.00;
        expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
        break;
      case 'monthly':
        amount = 10.00;
        expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
        break;
      case 'yearly':
        amount = 80.00;
        expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 365 days
        break;
    }

    // Get card details from payment method
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
    const last4 = paymentMethod.card.last4;

    connection = await pool.getConnection();

    // Create subscription record
    const [result] = await connection.query(
      `INSERT INTO subscriptions 
       (uid, planType, status, amount, currency, paymentMethod, cardLast4, 
        stripePaymentIntentId, startDate, expiresAt, createdAt, updatedAt) 
       VALUES (?, ?, 'active', ?, 'USD', 'card', ?, ?, NOW(), ?, NOW(), NOW())`,
      [uid, planType, amount, last4, paymentIntentId, expiresAt]
    );

    // Create payment transaction record
    await connection.query(
      `INSERT INTO payment_transactions 
       (subscriptionId, uid, amount, currency, status, paymentMethod, 
        transactionId, stripePaymentIntentId, createdAt) 
       VALUES (?, ?, ?, 'USD', 'completed', 'card', ?, ?, NOW())`,
      [result.insertId, uid, amount, `txn_${Date.now()}_${uid.substring(0, 8)}`, paymentIntentId]
    );

    console.log(`Subscription created: uid=${uid}, plan=${planType}, amount=$${amount}`);

    res.status(201).json({
      success: true,
      message: 'Subscription activated successfully',
      subscription: {
        id: result.insertId,
        planType: planType,
        amount: amount,
        status: 'active',
        expiresAt: expiresAt,
        cardLast4: last4,
      },
    });
  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ error: error.message || 'Failed to create subscription' });
  } finally {
    if (connection) connection.release();
  }
});

// Cancel Subscription
router.post('/landlord/:uid/subscription/cancel', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    connection = await pool.getConnection();
    
    await connection.query(
      `UPDATE subscriptions 
       SET status = 'cancelled', updatedAt = NOW() 
       WHERE uid = ? AND status = 'active'`,
      [uid]
    );

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled successfully',
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel subscription' });
  } finally {
    if (connection) connection.release();
  }
});

// Get Payment History
router.get('/landlord/:uid/payments', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    connection = await pool.getConnection();
    const [rows] = await connection.query(
      `SELECT pt.*, s.planType 
       FROM payment_transactions pt
       LEFT JOIN subscriptions s ON pt.subscriptionId = s.id
       WHERE pt.uid = ? 
       ORDER BY pt.createdAt DESC`,
      [uid]
    );

    res.status(200).json({
      success: true,
      transactions: rows,
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: error.message || 'Failed to get payment history' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;