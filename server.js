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
const landlordBioRoutes = require('./routes/landlord_bio');
const pool = require('./config/db');
require('dotenv').config();

const app = express();

// Middleware - CORS Configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    process.env.FRONTEND_URL, // Add your deployed frontend URL in env
  ].filter(Boolean), // Remove undefined values
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Health Check Route - FIXED
app.get('/', (req, res) => {
  res.json({ 
    message: 'RoomieRush API Server', 
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    const connection = await pool.getConnection();
    await connection.query('SELECT 1');
    connection.release();
    
    res.status(200).json({ 
      status: 'ok', 
      message: 'Server is running',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Database connection failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', roomieMatchesRoutes);
app.use('/api', subscriptionRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', matchesRoutes);
app.use('/api/landlord-bio', landlordBioRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableRoutes: [
      'GET /api/health',
      'POST /api/auth/signup',
      'POST /api/auth/login',
      'GET /api/users/:uid',
      'GET /api/rooms',
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
  console.log(`📋 Available routes:`);
  console.log(`   - Health: GET /api/health`);
  console.log(`   - Auth: /api/auth/*`);
  console.log(`   - Users: /api/users/*`);
  console.log(`   - Roomie Matches: /api/renter/:uid/roomie-match`);
  console.log(`   - Subscriptions: /api/landlord/:uid/subscription`);
  console.log(`   - Rooms: /api/rooms/*`);
  console.log(`   - Reviews: /api/reviews/*`);
  console.log(`   - Notifications: /api/notifications/*`);
  console.log(`   - Matches: /api/matches/*`);
  console.log(`   - Landlord Bio: /api/landlord-bio/*`);
});

module.exports = app;