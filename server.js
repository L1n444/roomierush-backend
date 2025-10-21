const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roomieMatchesRoutes = require('./routes/roomieMatches');
const subscriptionRoutes = require('./routes/subscriptions');
const roomsRoutes = require('./routes/rooms');
const reviewRoutes = require('./routes/reviews');
const notificationRoutes = require('./routes/notification');
const matchesRoutes = require('./routes/matches');
const landlordBioRoutes = require('./routes/landlord_bio'); // ADD THIS
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', roomieMatchesRoutes);
app.use('/api', subscriptionRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', matchesRoutes);
app.use('/api/landlord-bio', landlordBioRoutes); // ADD THIS

// Health Check
app.use('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
  console.log(`📋 Available routes:`);
  console.log(`   - Auth: /api/auth/*`);
  console.log(`   - Users: /api/users/*`);
  console.log(`   - Roomie Matches: /api/renter/:uid/roomie-match`);
  console.log(`   - Subscriptions: /api/landlord/:uid/subscription`);
  console.log(`   - Rooms: /api/rooms/*`);
  console.log(`   - Reviews: /api/reviews/*`);
  console.log(`   - Notifications: /api/notifications/*`);
  console.log(`   - Matches: /api/matches/*`);
  console.log(`   - Landlord Bio: /api/landlord-bio/*`); // ADD THIS
});

module.exports = app;