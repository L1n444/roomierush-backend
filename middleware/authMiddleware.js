const admin = require('firebase-admin');
const pool = require('../config/db');

// Initialize Firebase Admin
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();

// Authenticate middleware (verifies ID token)
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('authMiddleware: Received Authorization header:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('authMiddleware: Missing or invalid Authorization header');
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    console.log('authMiddleware: Verifying ID token:', idToken.substring(0, 20) + '...');
    const decodedToken = await auth.verifyIdToken(idToken);
    console.log('authMiddleware: Token verified, user:', decodedToken.uid);
    req.user = decodedToken; // Ensure the entire decoded token is passed
    next();
  } catch (error) {
    console.error('authMiddleware: Authentication error:', error);
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