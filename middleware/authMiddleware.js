const admin = require('firebase-admin');

// Initialize Firebase Admin
let serviceAccount;

// Check if running in production (Railway) or development (local)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Production: Parse from environment variable
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Firebase credentials loaded from environment variable');
    console.log('   Project ID:', serviceAccount.project_id);
  } catch (error) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', error);
    console.error('Error details:', error.message);
    console.error('Make sure the JSON is properly formatted and escaped');
    process.exit(1);
  }
} else if (process.env.NODE_ENV === 'production') {
  // Production but no environment variable set
  console.error('❌ FIREBASE_SERVICE_ACCOUNT environment variable is not set in production');
  console.error('Please set this variable in your Railway dashboard');
  console.error('Format: Single-line JSON string of your serviceAccountKey.json');
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
      console.log('   Project ID:', serviceAccount.project_id);
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
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin:', error.message);
    process.exit(1);
  }
} else {
  console.log('ℹ️  Firebase Admin already initialized');
}

const auth = admin.auth();

// Authenticate middleware (verifies ID token)
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      console.error('authMiddleware: No Authorization header provided');
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No authorization header provided' 
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      console.error('authMiddleware: Invalid Authorization header format');
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid authorization header format. Expected: Bearer <token>' 
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken || idToken === 'null' || idToken === 'undefined') {
      console.error('authMiddleware: Empty or invalid token');
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid token provided' 
      });
    }

    console.log('authMiddleware: Verifying token...');
    const decodedToken = await auth.verifyIdToken(idToken);
    console.log('authMiddleware: ✅ Token verified for user:', decodedToken.uid);
    
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('authMiddleware: Authentication error:', error.message);
    
    // Provide specific error messages
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        error: 'Token expired', 
        message: 'Your session has expired. Please login again.' 
      });
    }
    
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({ 
        error: 'Invalid token', 
        message: 'The provided token is invalid.' 
      });
    }
    
    res.status(401).json({ 
      error: 'Authentication failed',
      message: error.message || 'Invalid or expired token' 
    });
  }
};

// Authorize user middleware (checks UID match)
const authorizeUser = (req, res, next) => {
  const requestedUid = req.params.uid;
  const authenticatedUid = req.user.uid;
  
  console.log('authorizeUser: Checking UID match');
  console.log('  Authenticated UID:', authenticatedUid);
  console.log('  Requested UID:', requestedUid);
  
  if (authenticatedUid !== requestedUid) {
    console.error('authorizeUser: ❌ UID mismatch - Access denied');
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'You do not have permission to access this resource' 
    });
  }
  
  console.log('authorizeUser: ✅ UID match - Access granted');
  next();
};

module.exports = { authenticate, authorizeUser };