const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate, authorizeUser } = require('../middleware/authMiddleware');
const admin = require('firebase-admin');

// Record a like
router.post('/matches/like', authenticate, async (req, res) => {
  let connection;
  try {
    const { likerUid, likedUid } = req.body;

    if (!likerUid || !likedUid) {
      return res.status(400).json({ error: 'Both likerUid and likedUid are required' });
    }

    if (likerUid === likedUid) {
      return res.status(400).json({ error: 'Cannot like yourself' });
    }

    console.log('matches/like: Recording like from', likerUid, 'to', likedUid);

    connection = await pool.getConnection();

    // Check if already liked
    const [existing] = await connection.query(
      'SELECT * FROM matches WHERE userId = ? AND matchedUserId = ?',
      [likerUid, likedUid]
    );

    if (existing.length > 0) {
      console.log('matches/like: Already liked');
      return res.status(200).json({ 
        success: true, 
        isMatch: existing[0].isMatch === 1,
        message: 'Already liked' 
      });
    }

    // Check if the other user already liked this user (mutual match)
    const [reverseMatch] = await connection.query(
      'SELECT * FROM matches WHERE userId = ? AND matchedUserId = ?',
      [likedUid, likerUid]
    );

    const isMatch = reverseMatch.length > 0;

    // Insert the like
    await connection.query(
      'INSERT INTO matches (userId, matchedUserId, isMatch, createdAt) VALUES (?, ?, ?, NOW())',
      [likerUid, likedUid, isMatch ? 1 : 0]
    );

    if (isMatch) {
      // Update the reverse match to mark it as a mutual match
      await connection.query(
        'UPDATE matches SET isMatch = 1 WHERE userId = ? AND matchedUserId = ?',
        [likedUid, likerUid]
      );
      console.log('matches/like: Mutual match created!');
    }

    // Send notification to liked user
    try {
      const [likedUserData] = await connection.query(
        'SELECT fcmToken FROM users WHERE uid = ?',
        [likedUid]
      );

      const [likerUserData] = await connection.query(
        'SELECT firstName, lastName FROM users WHERE uid = ?',
        [likerUid]
      );

      if (likedUserData.length > 0 && likedUserData[0].fcmToken && likerUserData.length > 0) {
        const likerName = `${likerUserData[0].firstName} ${likerUserData[0].lastName}`;
        const fcmToken = likedUserData[0].fcmToken;

        const message = {
          notification: {
            title: isMatch ? '🎉 It\'s a Match!' : '💙 Someone likes you!',
            body: isMatch 
              ? `You and ${likerName} matched! Start chatting now.`
              : `${likerName} likes your profile. Swipe right to match!`,
          },
          data: {
            type: isMatch ? 'match' : 'like',
            fromUserId: likerUid,
            fromUserName: likerName,
          },
          token: fcmToken,
        };

        await admin.messaging().send(message);
        console.log('matches/like: Notification sent successfully');
      }
    } catch (notifError) {
      console.error('matches/like: Error sending notification:', notifError);
      // Don't fail the request if notification fails
    }

    res.status(200).json({
      success: true,
      isMatch: isMatch,
      message: isMatch ? 'Mutual match created!' : 'Like recorded',
    });
  } catch (error) {
    console.error('matches/like: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to record like' });
  } finally {
    if (connection) connection.release();
  }
});

// Record a pass
router.post('/matches/pass', authenticate, async (req, res) => {
  let connection;
  try {
    const { userId, passedUid } = req.body;

    if (!userId || !passedUid) {
      return res.status(400).json({ error: 'Both userId and passedUid are required' });
    }

    console.log('matches/pass: Recording pass from', userId, 'to', passedUid);

    connection = await pool.getConnection();

    // Check if already passed
    const [existing] = await connection.query(
      'SELECT * FROM passes WHERE userId = ? AND passedUid = ?',
      [userId, passedUid]
    );

    if (existing.length > 0) {
      console.log('matches/pass: Already passed');
      return res.status(200).json({ success: true, message: 'Already passed' });
    }

    // Insert the pass
    await connection.query(
      'INSERT INTO passes (userId, passedUid, createdAt) VALUES (?, ?, NOW())',
      [userId, passedUid]
    );

    console.log('matches/pass: Pass recorded successfully');

    res.status(200).json({
      success: true,
      message: 'Pass recorded',
    });
  } catch (error) {
    console.error('matches/pass: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to record pass' });
  } finally {
    if (connection) connection.release();
  }
});

// Get all matches for a user
router.get('/matches/:uid', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    console.log('matches/get: Fetching matches for', uid);

    connection = await pool.getConnection();

    const [matches] = await connection.query(
      `SELECT 
        m.matchedUserId as uid,
        m.isMatch,
        m.createdAt as matchedAt,
        u.firstName,
        u.lastName,
        u.imageUrl,
        rm.age,
        rm.gender,
        rm.description,
        rm.location,
        rm.minBudget,
        rm.maxBudget
      FROM matches m
      INNER JOIN users u ON m.matchedUserId = u.uid
      LEFT JOIN roomie_matches rm ON m.matchedUserId = rm.uid
      WHERE m.userId = ? AND m.isMatch = 1
      ORDER BY m.createdAt DESC`,
      [uid]
    );

    console.log(`matches/get: Found ${matches.length} matches`);

    const formattedMatches = matches.map(match => ({
      uid: match.uid,
      name: `${match.firstName} ${match.lastName}`,
      imageUrl: match.imageUrl || '',
      age: match.age,
      gender: match.gender,
      description: match.description,
      location: match.location,
      minBudget: match.minBudget,
      maxBudget: match.maxBudget,
      matchedAt: match.matchedAt,
    }));

    res.status(200).json({
      success: true,
      matches: formattedMatches,
    });
  } catch (error) {
    console.error('matches/get: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to get matches' });
  } finally {
    if (connection) connection.release();
  }
});

// Check if two users have matched
router.get('/matches/check', authenticate, async (req, res) => {
  let connection;
  try {
    const { userId1, userId2 } = req.query;

    if (!userId1 || !userId2) {
      return res.status(400).json({ error: 'Both userId1 and userId2 are required' });
    }

    connection = await pool.getConnection();

    const [match1] = await connection.query(
      'SELECT isMatch FROM matches WHERE userId = ? AND matchedUserId = ? AND isMatch = 1',
      [userId1, userId2]
    );

    const [match2] = await connection.query(
      'SELECT isMatch FROM matches WHERE userId = ? AND matchedUserId = ? AND isMatch = 1',
      [userId2, userId1]
    );

    const isMatch = match1.length > 0 && match2.length > 0;

    res.status(200).json({
      success: true,
      isMatch: isMatch,
    });
  } catch (error) {
    console.error('matches/check: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to check match' });
  } finally {
    if (connection) connection.release();
  }
});

// Unmatch with a user
router.delete('/matches/unmatch', authenticate, async (req, res) => {
  let connection;
  try {
    const { userId, matchedUserId } = req.body;

    if (!userId || !matchedUserId) {
      return res.status(400).json({ error: 'Both userId and matchedUserId are required' });
    }

    console.log('matches/unmatch: Unmatching', userId, 'from', matchedUserId);

    connection = await pool.getConnection();

    // Delete both directions of the match
    await connection.query(
      'DELETE FROM matches WHERE (userId = ? AND matchedUserId = ?) OR (userId = ? AND matchedUserId = ?)',
      [userId, matchedUserId, matchedUserId, userId]
    );

    console.log('matches/unmatch: Unmatched successfully');

    res.status(200).json({
      success: true,
      message: 'Unmatched successfully',
    });
  } catch (error) {
    console.error('matches/unmatch: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to unmatch' });
  } finally {
    if (connection) connection.release();
  }
});

// Reset all matches and passes for a user (when resetting Roomie Match)
router.delete('/matches/reset', authenticate, async (req, res) => {
  let connection;
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log('matches/reset: Resetting all matches for', userId);

    connection = await pool.getConnection();

    // Delete all matches where user is involved
    const deleteMatchesResult = await connection.query(
      'DELETE FROM matches WHERE userId = ? OR matchedUserId = ?',
      [userId, userId]
    );

    // Delete all passes by this user
    const deletePassesResult = await connection.query(
      'DELETE FROM passes WHERE userId = ?',
      [userId]
    );

    console.log(`matches/reset: Deleted ${deleteMatchesResult[0].affectedRows} match records`);
    console.log(`matches/reset: Deleted ${deletePassesResult[0].affectedRows} pass records`);

    res.status(200).json({
      success: true,
      message: 'All matches and passes reset successfully',
      deletedMatches: deleteMatchesResult[0].affectedRows,
      deletedPasses: deletePassesResult[0].affectedRows,
    });
  } catch (error) {
    console.error('matches/reset: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to reset matches' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;