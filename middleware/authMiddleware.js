const admin = require('firebase-admin');
const pool = require('../config/db');

// Initialize Firebase Admin
let serviceAccount;

// Check if running in production (Railway) or development (local)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Production: Parse from environment variable
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Firebase credentials loaded from environment variable');
  } catch (error) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
} else if (process.env.NODE_ENV === 'production') {
  // Production but no environment variable set
  console.error('❌ FIREBASE_SERVICE_ACCOUNT environment variable is not set in production');
  console.error('Please set this variable in your Railway dashboard');
  process.exit(1);
} else {
  // Development: Try to load from file
  try {
    const fs = require('fs');
    const path = require('path');
    const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    
    if (fs.existsSync(keyPath)) {
      serviceAccount = require('../serviceAccountKey.json');
      console.log('✅ Firebase credentials loaded from serviceAccountKey.json');
    } else {
      console.error('❌ serviceAccountKey.json not found at:', keyPath);
      console.error('For local development, create this file with your Firebase credentials');
      console.error('For production, set FIREBASE_SERVICE_ACCOUNT environment variable');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to load serviceAccountKey.json:', error.message);
    process.exit(1);
  }
}

// Initialize Firebase Admin only once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('✅ Firebase Admin initialized');
}

const auth = admin.auth();

// Authenticate middleware (verifies ID token)
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('authMiddleware: Received Authorization header:', authHeader ? 'Present' : 'Missing');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('authMiddleware: Missing or invalid Authorization header');
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    console.log('authMiddleware: Verifying ID token...');
    const decodedToken = await auth.verifyIdToken(idToken);
    console.log('authMiddleware: Token verified, user:', decodedToken.uid);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('authMiddleware: Authentication error:', error.message);
    res.status(401).json({ error: error.message || 'Invalid or expired token' });
  }
};

// Authorize user middleware (checks UID match)
const authorizeUser = (req, res, next) => {
  console.log('authorizeUser: Checking UID match, req.user.uid=', req.user.uid, 'req.params.uid=', req.params.uid);
  if (req.user.uid !== req.params.uid) {
    return res.status(403).json({ error: 'Forbidden: Access to this user is not allowed' });
  }
  next();
};

module.exports = { authenticate, authorizeUser };