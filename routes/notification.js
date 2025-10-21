const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { authenticate } = require('../middleware/authMiddleware');
const pool = require('../config/db');

// Save FCM token
router.post('/save-token', authenticate, async (req, res) => {
  let connection;
  try {
    const { token } = req.body;
    const uid = req.user.uid;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    console.log('Notifications: Saving FCM token for uid:', uid);

    connection = await pool.getConnection();
    await connection.query(
      'UPDATE users SET fcmToken = ? WHERE uid = ?',
      [token, uid]
    );

    console.log('Notifications: FCM token saved successfully');
    res.json({ message: 'Token saved successfully' });
  } catch (error) {
    console.error('Error saving token:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to save token', details: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Remove FCM token on logout
router.post('/remove-token', authenticate, async (req, res) => {
  let connection;
  try {
    const uid = req.user.uid;

    console.log('Notifications: Removing FCM token for uid:', uid);

    connection = await pool.getConnection();
    await connection.query(
      'UPDATE users SET fcmToken = NULL WHERE uid = ?',
      [uid]
    );

    console.log('Notifications: FCM token removed successfully');
    res.json({ message: 'Token removed successfully' });
  } catch (error) {
    console.error('Error removing token:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to remove token', details: error.message });
  } finally {
    if (connection) connection.release();
  }
});

router.post('/preference', authenticate, async (req, res) => {
  let connection;
  try {
    const { notificationsEnabled, uid } = req.body; // Use uid from body
    if (notificationsEnabled === undefined || !uid) {
      return res.status(400).json({ error: 'notificationsEnabled and uid are required' });
    }
    if (uid !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    console.log('Notifications: Saving notification preference for uid:', uid, 'value:', notificationsEnabled);
    connection = await pool.getConnection();
    const [result] = await connection.query(
      'UPDATE users SET notificationsEnabled = ? WHERE uid = ?',
      [notificationsEnabled ? 1 : 0, uid]
    );
    if (result.affectedRows === 0) {
      console.log('Notifications: No user found with uid:', uid);
      return res.status(404).json({ error: 'User not found' });
    }
    console.log('Notifications: Notification preference saved successfully');
    res.json({ message: 'Notification preference saved successfully' });
  } catch (error) {
    console.error('Error saving notification preference:', error.message, error.stack);
    res.status(500).json({ 
      error: 'Failed to save notification preference', 
      details: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

// Send notification
router.post('/send', authenticate, async (req, res) => {
  let connection;
  try {
    const { recipientUid, title, body, data } = req.body;

    if (!recipientUid || !title || !body) {
      return res.status(400).json({ 
        error: 'recipientUid, title, and body are required' 
      });
    }

    console.log('Notifications: Sending notification to:', recipientUid);

    connection = await pool.getConnection();
    
    // Check if recipient has notifications enabled
    const [users] = await connection.query(
      'SELECT fcmToken, notificationsEnabled FROM users WHERE uid = ?',
      [recipientUid]
    );

    if (users.length === 0) {
      console.log('Notifications: Recipient not found');
      // Still save to database even if FCM fails
      await connection.query(
        `INSERT INTO notifications (recipientUid, senderUid, title, message, type, data, createdAt) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [recipientUid, req.user.uid, title, body, data?.type || 'general', JSON.stringify(data || {})]
      );
      
      return res.json({ 
        message: 'Notification saved but recipient not found',
        fcmSent: false 
      });
    }

    const { fcmToken, notificationsEnabled } = users[0];
    
    if (!notificationsEnabled) {
      console.log('Notifications: Recipient has notifications disabled');
      // Save notification to database even if notifications are disabled
      await connection.query(
        `INSERT INTO notifications (recipientUid, senderUid, title, message, type, data, createdAt) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [recipientUid, req.user.uid, title, body, data?.type || 'general', JSON.stringify(data || {})]
      );
      
      return res.json({ 
        message: 'Notification saved but recipient has notifications disabled',
        fcmSent: false 
      });
    }

    if (!fcmToken) {
      console.log('Notifications: No FCM token for recipient');
      // Save notification to database even without FCM token
      await connection.query(
        `INSERT INTO notifications (recipientUid, senderUid, title, message, type, data, createdAt) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [recipientUid, req.user.uid, title, body, data?.type || 'general', JSON.stringify(data || {})]
      );
      
      return res.json({ 
        message: 'Notification saved but no FCM token available',
        fcmSent: false 
      });
    }

    // Try to send FCM notification
    let fcmResponse = null;
    let fcmError = null;
    
    try {
      const message = {
        notification: {
          title: title,
          body: body,
        },
        data: data || {},
        token: fcmToken,
      };

      fcmResponse = await admin.messaging().send(message);
      console.log('Notification sent successfully:', fcmResponse);
    } catch (error) {
      console.error('FCM Error:', error.message, error.stack);
      fcmError = error;
      
      // If token is invalid, remove it from database
      if (error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token') {
        console.log('Removing invalid FCM token for user:', recipientUid);
        await connection.query(
          'UPDATE users SET fcmToken = NULL WHERE uid = ?',
          [recipientUid]
        );
      }
    }

    // Always save notification to database
    await connection.query(
      `INSERT INTO notifications (recipientUid, senderUid, title, message, type, data, createdAt) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [recipientUid, req.user.uid, title, body, data?.type || 'general', JSON.stringify(data || {})]
    );

    if (fcmError) {
      res.json({ 
        message: 'Notification saved but FCM delivery failed',
        fcmSent: false,
        error: fcmError.message 
      });
    } else {
      res.json({ 
        message: 'Notification sent successfully', 
        fcmSent: true,
        response: fcmResponse 
      });
    }
  } catch (error) {
    console.error('Error sending notification:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to send notification', details: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get notifications for user
router.get('/user/:uid', authenticate, async (req, res) => {
  let connection;
  try {
    const uid = req.params.uid;

    // Verify the requesting user is getting their own notifications
    if (uid !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    console.log('Notifications: Getting notifications for uid:', uid);

    connection = await pool.getConnection();
    const [notifications] = await connection.query(
      `SELECT n.*, 
              u.firstName as senderFirstName, 
              u.lastName as senderLastName,
              u.imageUrl as senderImageUrl
       FROM notifications n
       LEFT JOIN users u ON n.senderUid = u.uid
       WHERE n.recipientUid = ?
       ORDER BY n.createdAt DESC
       LIMIT 50`,
      [uid]
    );

    console.log(`Notifications: Found ${notifications.length} notifications`);
    res.json(notifications);
  } catch (error) {
    console.error('Error getting notifications:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to get notifications', details: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Mark notification as read
router.patch('/:id/read', authenticate, async (req, res) => {
  let connection;
  try {
    const notificationId = req.params.id;
    
    console.log('Notifications: Marking notification as read:', notificationId);

    connection = await pool.getConnection();
    
    // Verify ownership
    const [notifications] = await connection.query(
      'SELECT recipientUid FROM notifications WHERE id = ?',
      [notificationId]
    );
    
    if (notifications.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    if (notifications[0].recipientUid !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    await connection.query(
      'UPDATE notifications SET isRead = 1 WHERE id = ?',
      [notificationId]
    );
    
    console.log('Notifications: Notification marked as read');
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to mark notification as read', details: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Delete notification
router.delete('/:id', authenticate, async (req, res) => {
  let connection;
  try {
    const notificationId = req.params.id;
    
    console.log('Notifications: Deleting notification id:', notificationId);

    connection = await pool.getConnection();
    
    // Verify ownership before deleting
    const [notifications] = await connection.query(
      'SELECT recipientUid FROM notifications WHERE id = ?',
      [notificationId]
    );
    
    if (notifications.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    if (notifications[0].recipientUid !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    await connection.query('DELETE FROM notifications WHERE id = ?', [notificationId]);
    
    console.log('Notifications: Notification deleted successfully');
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to delete notification', details: error.message });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;