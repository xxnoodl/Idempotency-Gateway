const express = require('express');
const crypto = require('crypto');

const router = express.Router();

router.post('/process-payment', async (req, res) => {
  const { amount, currency } = req.body;

  if (amount == null || !currency) {
    return res.status(400).json({ error: 'Request body must include "amount" and "currency".' });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: '"amount" must be a positive number.' });
  }

  // Simulate payment processing
  await new Promise((resolve) => setTimeout(resolve, 2000));

  res.status(201).json({
    message: `Charged ${amount} ${currency}`,
    transactionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
