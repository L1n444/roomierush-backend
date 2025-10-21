const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');

const auth = admin.auth();
const SALT_ROUNDS = 10;

// Sign Up with Email/Password
router.post('/signup', async (req, res) => {
  let connection;
  try {
    const { email, password, role, profileData } = req.body;
    console.log('auth/signup: Received request:', { email, role, profileData });

    if (!email || !password || !role) {
      console.error('auth/signup: Missing required fields');
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }

    if (!['Renter', 'Landlord'].includes(role)) {
      console.error('auth/signup: Invalid role:', role);
      return res.status(400).json({ error: 'Invalid role. Must be "Renter" or "Landlord"' });
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const userRecord = await auth.createUser({
      email: email,
      password: password,
      emailVerified: false,
    });

    connection = await pool.getConnection();
    await connection.query(
      'INSERT INTO users (uid, email, role, passwordHash, createdAt, updatedAt, profileCompleted) VALUES (?, ?, ?, ?, NOW(), NOW(), 0)',
      [userRecord.uid, email, role, passwordHash]
    );

    const customToken = await auth.createCustomToken(userRecord.uid);
    console.log('auth/signup: User created, uid:', userRecord.uid);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      uid: userRecord.uid,
      customToken: customToken,
      email: email,
      role: role,
    });
  } catch (error) {
    console.error('auth/signup: Signup error:', error);
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: error.message || 'Failed to create user' });
  } finally {
    if (connection) connection.release();
  }
});

// Login with Email/Password
router.post('/login', async (req, res) => {
  let connection;
  try {
    const { email, password } = req.body;
    console.log('auth/login: Received request:', { email });

    if (!email || !password) {
      console.error('auth/login: Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const userRecord = await auth.getUserByEmail(email);
    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT role, profileCompleted, passwordHash FROM users WHERE uid = ?', [userRecord.uid]);

    if (rows.length === 0) {
      console.error('auth/login: User data not found for uid:', userRecord.uid);
      return res.status(404).json({ error: 'User data not found' });
    }

    const userData = rows[0];
    
    // If passwordHash doesn't exist (old user), create it
    if (!userData.passwordHash) {
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      await connection.query('UPDATE users SET passwordHash = ? WHERE uid = ?', [passwordHash, userRecord.uid]);
    }

    const customToken = await auth.createCustomToken(userRecord.uid);
    console.log('auth/login: Login successful, uid:', userRecord.uid);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      uid: userRecord.uid,
      customToken: customToken,
      email: email,
      role: userData.role,
      profileCompleted: userData.profileCompleted || 0,
    });
  } catch (error) {
    console.error('auth/login: Login error:', error);
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: error.message || 'Login failed' });
  } finally {
    if (connection) connection.release();
  }
});

// Change Password
router.post('/change-password', authenticate, async (req, res) => {
  let connection;
  try {
    const { currentPassword, newPassword } = req.body;
    const uid = req.user.uid; // Fixed: Use req.user.uid instead of req.uid

    console.log('auth/change-password: Received request for uid:', uid);

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT passwordHash, email FROM users WHERE uid = ?', [uid]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { passwordHash, email } = rows[0];

    // Verify current password
    if (passwordHash) {
      const isValidPassword = await bcrypt.compare(currentPassword, passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    } else {
      // For users who don't have a hash yet (migrated users), we need to verify with Firebase
      try {
        console.log('auth/change-password: User has no password hash, creating one');
      } catch (e) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password in database
    await connection.query('UPDATE users SET passwordHash = ?, updatedAt = NOW() WHERE uid = ?', [newPasswordHash, uid]);

    // Update password in Firebase Auth
    await auth.updateUser(uid, {
      password: newPassword
    });

    console.log('auth/change-password: Password updated successfully for uid:', uid);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('auth/change-password: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to change password' });
  } finally {
    if (connection) connection.release();
  }
});

// Google Sign In
router.post('/google', async (req, res) => {
  let connection;
  try {
    const { idToken, role } = req.body;
    console.log('auth/google: Received request:', { idToken: idToken?.substring(0, 20), role });

    if (!idToken) {
      console.error('auth/google: ID token is required');
      return res.status(400).json({ error: 'ID token is required' });
    }

    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT role, profileCompleted FROM users WHERE uid = ?', [uid]);

    let userData;
    let isNewUser = false;

    if (rows.length === 0) {
      isNewUser = true;
      if (!role || !['Renter', 'Landlord'].includes(role)) {
        console.error('auth/google: Role is required for new users');
        return res.status(400).json({ error: 'Role is required for new users' });
      }

      // Google users don't have a password hash (OAuth only)
      await connection.query(
        'INSERT INTO users (uid, email, role, passwordHash, createdAt, updatedAt, profileCompleted) VALUES (?, ?, ?, NULL, NOW(), NOW(), 0)',
        [uid, email, role]
      );

      userData = { role: role, profileCompleted: 0 };
    } else {
      userData = rows[0];
    }

    const customToken = await auth.createCustomToken(uid);
    console.log('auth/google: Success, uid:', uid, 'isNewUser:', isNewUser);

    res.status(200).json({
      success: true,
      message: isNewUser ? 'User created successfully' : 'Login successful',
      uid: uid,
      customToken: customToken,
      email: email,
      role: userData.role,
      profileCompleted: userData.profileCompleted || 0,
      isNewUser: isNewUser,
    });
  } catch (error) {
    console.error('auth/google: Google auth error:', error);
    res.status(500).json({ error: error.message || 'Google authentication failed' });
  } finally {
    if (connection) connection.release();
  }
});

// Verify Token
router.post('/verify', async (req, res) => {
  let connection;
  try {
    const authHeader = req.headers.authorization;
    const { idToken } = req.body;
    console.log('auth/verify: Received Authorization header:', authHeader);
    console.log('auth/verify: Received ID token in body:', idToken ? idToken.substring(0, 20) + '...' : 'null');

    if (!idToken && (!authHeader || !authHeader.startsWith('Bearer '))) {
      console.error('auth/verify: No ID token provided');
      return res.status(400).json({ error: 'ID token is required' });
    }

    const tokenToVerify = idToken || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split('Bearer ')[1] : null);
    if (!tokenToVerify) {
      console.error('auth/verify: No valid token provided');
      return res.status(400).json({ error: 'No valid token provided' });
    }

    console.log('auth/verify: Verifying token:', tokenToVerify.substring(0, 20) + '...');
    const decodedToken = await auth.verifyIdToken(tokenToVerify);
    const uid = decodedToken.uid;
    console.log('auth/verify: Token verified, uid:', uid);

    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT email, role, profileCompleted FROM users WHERE uid = ?', [uid]);

    if (rows.length === 0) {
      console.error('auth/verify: User not found, uid:', uid);
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = rows[0];
    res.status(200).json({
      success: true,
      uid: uid,
      email: userData.email,
      role: userData.role,
      profileCompleted: userData.profileCompleted,
    });
  } catch (error) {
    console.error('auth/verify: Token verification error:', error);
    res.status(401).json({ error: error.message || 'Invalid or expired token' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;