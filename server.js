const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roomieMatchesRoutes = require('./routes/roomieMatches');
const subscriptionRoutes = require('./routes/subscriptions');
const roomsRoutes = require('./routes/rooms');
const reviewRoutes = require('./routes/reviews');
const notificationRoutes = require('./routes/notification');
const matchesRoutes = require('./routes/matches');
const landlordBioRoutes = require('./routes/landlord_bio');

const app = express();

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());

// ---------- Routes ----------
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roomie-matches', roomieMatchesRoutes);      // <-- unique prefix
app.use('/api/subscriptions', subscriptionRoutes);       // <-- unique prefix
app.use('/api/rooms', roomsRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/matches', matchesRoutes);                  // <-- unique prefix
app.use('/api/landlord-bio', landlordBioRoutes);

// ---------- Health Check ----------
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// ---------- Global Error Handler ----------
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// ---------- Start Server ----------
const PORT = (() => {
  const raw = process.env.PORT;

  // Local dev fallback
  if (!raw) return 3000;

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 0 || parsed > 65535) {
    console.error(
      `Invalid PORT value "${raw}". Must be an integer between 0 and 65535.`
    );
    process.exit(1);
  }
  return parsed;
})();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API Base URL: http://localhost:${PORT}/api`);
  console.log(`Available routes:`);
  console.log(`   - Auth:           /api/auth/*`);
  console.log(`   - Users:          /api/users/*`);
  console.log(`   - Roomie Matches: /api/roomie-matches/*`);
  console.log(`   - Subscriptions:  /api/subscriptions/*`);
  console.log(`   - Rooms:          /api/rooms/*`);
  console.log(`   - Reviews:        /api/reviews/*`);
  console.log(`   - Notifications:  /api/notifications/*`);
  console.log(`   - Matches:        /api/matches/*`);
  console.log(`   - Landlord Bio:   /api/landlord-bio/*`);
});

module.exports = app;