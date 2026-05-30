const express = require('express');
const idempotencyMiddleware = require('./middleware/idempotency');
const paymentRoutes = require('./routes/payment');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(idempotencyMiddleware);
app.use(paymentRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Idempotency Gateway running on http://localhost:${PORT}`);
});

module.exports = app;
