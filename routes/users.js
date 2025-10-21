const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate, authorizeUser } = require('../middleware/authMiddleware');

// Get Public User Profile (NO AUTHENTICATION REQUIRED)
router.get('/:uid/public', async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    
    console.log('Getting public profile for uid:', uid);

    connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT firstName, lastName, imageUrl FROM users WHERE uid = ?', 
      [uid]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = rows[0];

    console.log('Public profile found:', userData);

    res.status(200).json({
      success: true,
      user: {
        firstName: userData.firstName,
        lastName: userData.lastName,
        imageUrl: userData.imageUrl,
      },
    });
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to get public profile' });
  } finally {
    if (connection) connection.release();
  }
});

// Get User Data for Chat Sync (AUTHENTICATED)
// This endpoint fetches user data from MySQL to sync to Firestore for chat
router.post('/chat-sync', authenticate, async (req, res) => {
  let connection;
  try {
    const { uids } = req.body; // Array of user IDs to fetch
    
    if (!Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({ error: 'uids array is required' });
    }

    console.log('Fetching user data for chat sync, uids:', uids);

    connection = await pool.getConnection();
    
    // Use IN clause to fetch multiple users at once
    const placeholders = uids.map(() => '?').join(',');
    const [rows] = await connection.query(
      `SELECT uid, firstName, lastName, imageUrl, email 
       FROM users 
       WHERE uid IN (${placeholders})`,
      uids
    );
    
    console.log(`Found ${rows.length} users for chat sync`);

    // Return as an object keyed by UID for easy lookup
    const usersData = {};
    rows.forEach(user => {
      usersData[user.uid] = {
        uid: user.uid,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        imageUrl: user.imageUrl || '',
        email: user.email || '',
      };
    });

    res.status(200).json({
      success: true,
      users: usersData,
    });
  } catch (error) {
    console.error('Chat sync error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch user data' });
  } finally {
    if (connection) connection.release();
  }
});

// Update Profile
router.put('/:uid/profile', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;
    const { firstName, lastName, imageUrl } = req.body;

    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT 1 FROM users WHERE uid = ?', [uid]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const updateFields = [];
    const values = [];
    if (firstName) { updateFields.push('firstName = ?'); values.push(firstName); }
    if (lastName) { updateFields.push('lastName = ?'); values.push(lastName); }
    if (imageUrl) { updateFields.push('imageUrl = ?'); values.push(imageUrl); }
    if (updateFields.length > 0) {
      updateFields.push('updatedAt = NOW()');
      const query = `UPDATE users SET ${updateFields.join(', ')} WHERE uid = ?`;
      values.push(uid);
      await connection.query(query, values);
    }

    res.status(200).json({ success: true, message: 'Profile updated' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: error.message || 'Failed to update profile' });
  } finally {
    if (connection) connection.release();
  }
});

// Get User Profile
router.get('/:uid', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT * FROM users WHERE uid = ?', [uid]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const userData = rows[0];

    res.status(200).json({
      success: true,
      user: {
        uid: uid,
        ...userData,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: error.message || 'Failed to get user' });
  } finally {
    if (connection) connection.release();
  }
});

// Delete User Account
router.delete('/:uid', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    connection = await pool.getConnection();
    await connection.query('DELETE FROM users WHERE uid = ?', [uid]);
    await auth.deleteUser(uid);

    res.status(200).json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete user' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;