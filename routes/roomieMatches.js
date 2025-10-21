const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate, authorizeUser } = require('../middleware/authMiddleware');

// Create or Update Roomie Match Preferences (WITH GENDER)
router.post('/renter/:uid/roomie-match', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;
    const { age, gender, description, lifestyles, interests, location, minBudget, maxBudget } = req.body;

    console.log('roomieMatches/post: Received data:', { uid, age, gender, description: description?.substring(0, 50), lifestyles, interests, location, minBudget, maxBudget });

    if (!age || !gender || !description || !lifestyles || !interests || !location || minBudget === undefined || maxBudget === undefined) {
      console.error('roomieMatches/post: Missing required fields');
      return res.status(400).json({ error: 'All fields (age, gender, description, lifestyles, interests, location, minBudget, maxBudget) are required' });
    }

    connection = await pool.getConnection();
    const [existing] = await connection.query('SELECT 1 FROM roomie_matches WHERE uid = ?', [uid]);
    
    const data = {
      uid,
      gender,
      age,
      description,
      lifestyles: JSON.stringify(lifestyles),
      interests: JSON.stringify(interests),
      location,
      minBudget,
      maxBudget,
      hasCompleted: 1,
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await connection.query('UPDATE roomie_matches SET ? WHERE uid = ?', [data, uid]);
      console.log('roomieMatches/post: Updated preferences for uid:', uid);
    } else {
      await connection.query('INSERT INTO roomie_matches SET ?', [data]);
      console.log('roomieMatches/post: Created preferences for uid:', uid);
    }

    res.status(200).json({
      success: true,
      message: existing.length > 0 ? 'Preferences updated' : 'Preferences created',
    });
  } catch (error) {
    console.error('roomieMatches/post: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to update roomie match preferences' });
  } finally {
    if (connection) connection.release();
  }
});

// Get Roomie Match Preferences
router.get('/renter/:uid/roomie-match', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT * FROM roomie_matches WHERE uid = ?', [uid]);
    if (rows.length === 0) {
      console.log('roomieMatches/get: No preferences found for uid:', uid);
      return res.status(404).json({ error: 'No preferences found' });
    }

    const preferences = rows[0];
    
    const parseArrayField = (field, fieldName) => {
      if (Array.isArray(field)) return field;
      if (typeof field === 'string') {
        if (field.startsWith('[')) {
          try {
            return JSON.parse(field);
          } catch (e) {
            console.error(`JSON parse error for ${fieldName}:`, e);
            return field.split(',').map(item => item.trim()).filter(item => item);
          }
        }
        return field.split(',').map(item => item.trim()).filter(item => item);
      }
      return [];
    };

    preferences.lifestyles = parseArrayField(preferences.lifestyles, 'lifestyles');
    preferences.interests = parseArrayField(preferences.interests, 'interests');

    console.log('roomieMatches/get: Retrieved preferences for uid:', uid);

    res.status(200).json({
      success: true,
      preferences: preferences,
    });
  } catch (error) {
    console.error('roomieMatches/get: Error for uid=', req.params.uid, ':', error);
    res.status(500).json({ error: error.message || 'Failed to get roomie match preferences' });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/renter/:uid/matches', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;
    const { location, minBudget, maxBudget, interestedIn, minAge, maxAge } = req.query;

    console.log('roomieMatches/matches: Fetching matches for uid:', uid);
    console.log('  Query params received:', { location, minBudget, maxBudget, interestedIn, minAge, maxAge });

    connection = await pool.getConnection();
    
    // Get current user's preferences
    const [currentUser] = await connection.query(
      'SELECT * FROM roomie_matches WHERE uid = ?',
      [uid]
    );

    if (currentUser.length === 0) {
      return res.status(404).json({ error: 'User preferences not found' });
    }

    // Build query to find matches, excluding users already liked or passed
    let query = `
      SELECT 
        rm.uid,
        rm.age,
        rm.gender,
        rm.description,
        rm.lifestyles,
        rm.interests,
        rm.location,
        rm.minBudget,
        rm.maxBudget,
        u.firstName,
        u.lastName,
        u.imageUrl
      FROM roomie_matches rm
      INNER JOIN users u ON rm.uid = u.uid
      WHERE rm.uid != ? 
        AND rm.hasCompleted = 1
        AND rm.uid NOT IN (
          SELECT matchedUserId FROM matches WHERE userId = ?
        )
        AND rm.uid NOT IN (
          SELECT passedUid FROM passes WHERE userId = ?
        )
    `;
    
    const params = [uid, uid, uid];

    // Apply location filter ONLY if provided
    if (location && location !== 'Select Khan' && location !== 'Not set' && location !== 'undefined') {
      query += ' AND rm.location = ?';
      params.push(location);
      console.log('roomieMatches/matches: Applying location filter:', location);
    }

    // Apply budget filter ONLY if BOTH minBudget and maxBudget are provided
    if (minBudget !== undefined && maxBudget !== undefined && minBudget !== 'undefined' && maxBudget !== 'undefined') {
      const minBudgetNum = parseFloat(minBudget);
      const maxBudgetNum = parseFloat(maxBudget);
      
      // User's budget range overlaps with potential match's budget range
      query += ' AND rm.minBudget <= ? AND rm.maxBudget >= ?';
      params.push(maxBudgetNum, minBudgetNum);
      console.log('roomieMatches/matches: Applying budget filter:', minBudgetNum, '-', maxBudgetNum);
    }

    // Apply gender filter ONLY if provided and not empty
    if (interestedIn && interestedIn !== '' && interestedIn !== 'undefined') {
      query += ' AND rm.gender = ?';
      params.push(interestedIn);
      console.log('roomieMatches/matches: Applying gender filter:', interestedIn);
    }

    // Apply age filter ONLY if BOTH minAge and maxAge are provided
    if (minAge !== undefined && maxAge !== undefined && minAge !== 'undefined' && maxAge !== 'undefined') {
      const minAgeNum = parseInt(minAge);
      const maxAgeNum = parseInt(maxAge);
      
      query += ' AND rm.age BETWEEN ? AND ?';
      params.push(minAgeNum, maxAgeNum);
      console.log('roomieMatches/matches: Applying age filter:', minAgeNum, '-', maxAgeNum);
    }

    query += ' ORDER BY RAND() LIMIT 50';

    console.log('roomieMatches/matches: Final query:', query);
    console.log('roomieMatches/matches: Params:', params);

    const [matches] = await connection.query(query, params);

    console.log(`roomieMatches/matches: Found ${matches.length} potential matches`);

    // Parse JSON fields
    const formattedMatches = matches.map(match => {
      const parseArrayField = (field) => {
        if (Array.isArray(field)) return field;
        if (typeof field === 'string') {
          try {
            return JSON.parse(field);
          } catch (e) {
            return field.split(',').map(item => item.trim()).filter(item => item);
          }
        }
        return [];
      };

      const formattedMatch = {
        uid: match.uid,
        name: `${match.firstName} ${match.lastName}`,
        age: match.age,
        ageVisible: true,
        imageAsset: match.imageUrl || '',
        aboutMe: match.description,
        interests: parseArrayField(match.interests),
        lifestyles: parseArrayField(match.lifestyles),
        gender: match.gender,
        location: match.location,
        minBudget: parseFloat(match.minBudget),
        maxBudget: parseFloat(match.maxBudget),
      };

      console.log(`roomieMatches/matches: Match ${match.uid} - Gender: ${match.gender}, Name: ${match.firstName} ${match.lastName}`);
      
      return formattedMatch;
    });

    res.status(200).json({
      success: true,
      matches: formattedMatches,
      count: formattedMatches.length,
    });
  } catch (error) {
    console.error('roomieMatches/matches: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch matches' });
  } finally {
    if (connection) connection.release();
  }
});

// Delete Roomie Match Preferences
router.delete('/renter/:uid/roomie-match', authenticate, authorizeUser, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    connection = await pool.getConnection();
    const [result] = await connection.query('DELETE FROM roomie_matches WHERE uid = ?', [uid]);

    console.log('roomieMatches/delete: Deleted rows:', result.affectedRows);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No preferences found' });
    }

    res.status(200).json({
      success: true,
      message: 'Preferences deleted',
    });
  } catch (error) {
    console.error('roomieMatches/delete: Error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete roomie match preferences' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;