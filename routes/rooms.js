const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');

// Update the parseJsonField function to handle more edge cases
function parseJsonField(field, defaultValue = []) {
  // If it's already an array (MySQL auto-parsed it), return as-is
  if (Array.isArray(field)) {
    return field;
  }
  
  // If it's already an object, return as-is
  if (typeof field === 'object' && field !== null) {
    return field;
  }
  
  // If it's a string, try to parse it
  if (typeof field === 'string') {
    try {
      const parsed = JSON.parse(field);
      return parsed;
    } catch (e) {
      console.error('Failed to parse JSON field:', e.message);
      // Handle comma-separated strings (legacy format)
      if (field.includes(',')) {
        return field.split(',').map(item => item.trim()).filter(item => item);
      }
      // If it's an empty string or 'null', return default value
      if (!field.trim() || field.trim().toLowerCase() === 'null') {
          return defaultValue;
      }
      // If it's a single non-empty string, return as array with one item
      if (field.trim()) {
        return [field.trim()];
      }
    }
  }
  
  // Handle null/undefined
  if (field === null || field === undefined) {
    return defaultValue;
  }
  
  return defaultValue;
}

/**
 * Safely parse an integer or return null.
 * Ensures that if a numeric string is provided, it's converted to an integer,
 * otherwise, it defaults to null for the database.
 */
function safeParseInt(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const num = parseInt(value, 10);
    return isNaN(num) ? null : num;
}


// Create room posting
router.post('/', authenticate, async (req, res) => {
  let connection;
  try {
    const uid = req.user.uid;
    const roomData = req.body;

    console.log('Creating room posting for uid:', uid);
    console.log('Room data received:', roomData);

    connection = await pool.getConnection();

    // Check for active subscription
    const [subscriptionRows] = await connection.query(
      'SELECT * FROM subscriptions WHERE uid = ? AND status = "active" ORDER BY createdAt DESC LIMIT 1',
      [uid]
    );

    if (subscriptionRows.length === 0) {
      return res.status(403).json({ 
        error: 'No active subscription found. Please subscribe to create a post.' 
      });
    }

    const subscription = subscriptionRows[0];
    const now = new Date();
    const expiresAt = new Date(subscription.expiresAt);

    // Check if subscription expired
    if (expiresAt <= now) {
      await connection.query(
        'UPDATE subscriptions SET status = "expired" WHERE id = ?',
        [subscription.id]
      );
      return res.status(403).json({ 
        error: 'Your subscription has expired. Please renew to create a post.' 
      });
    }

    // Check per_post limit
    if (subscription.planType === 'per_post') {
      const [postRows] = await connection.query(
        'SELECT COUNT(*) as postCount FROM room_postings WHERE uid = ? AND subscriptionId = ?',
        [uid, subscription.id]
      );

      if (postRows[0].postCount >= 1) {
        return res.status(403).json({ 
          error: 'You have already used your single post. Please subscribe again to create another post.' 
        });
      }
    }

    // Validate required fields
    if (!roomData.address) {
      return res.status(400).json({ error: 'Address is required' });
    }
    if (!roomData.title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!roomData.description) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (!roomData.location) {
      return res.status(400).json({ error: 'Location is required' });
    }
    if (!roomData.roomType) {
      return res.status(400).json({ error: 'Room type is required' });
    }

    // Prepare data with proper types
    const insertData = {
      uid: uid,
      subscriptionId: subscription.id,
      title: roomData.title || '',
      description: roomData.description || '',
      price: roomData.isFree ? null : (roomData.price || null),
      location: roomData.location || '',
      address: roomData.address || '',
      roomType: roomData.roomType || '',
      dimension: roomData.dimension || null,
      // FIX: Use safeParseInt for optional integer fields
      bedroom: safeParseInt(roomData.bedroom),
      bathroom: safeParseInt(roomData.bathroom),
      floor: safeParseInt(roomData.floor),
      // Ensure amenities and images are stringified JSON arrays for MySQL
      amenities: JSON.stringify(roomData.amenities || []),
      images: JSON.stringify(roomData.images || []),
      isFree: roomData.isFree ? 1 : 0,
      status: 'active',
    };

    console.log('Insert data:', insertData);

    const [result] = await connection.query(
      `INSERT INTO room_postings SET ?, createdAt = NOW(), updatedAt = NOW()`,
      [insertData]
    );

    console.log(`Room posting created: id=${result.insertId}, uid=${uid}, subscriptionId=${subscription.id}`);

    res.status(201).json({
      success: true,
      message: 'Room posting created successfully',
      roomId: result.insertId,
      subscription: {
        planType: subscription.planType,
        expiresAt: subscription.expiresAt,
      },
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: error.message || 'Failed to create room posting' });
  } finally {
    if (connection) connection.release();
  }
});

// Get user's room postings (authenticated - own posts only)
router.get('/user/:uid', authenticate, async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    // Verify user can only access their own posts
    if (req.user.uid !== uid) {
      return res.status(403).json({ error: 'Forbidden: Cannot access other user\'s posts' });
    }

    console.log('Getting authenticated room postings for uid:', uid);

    connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT * FROM room_postings WHERE uid = ? ORDER BY createdAt DESC',
      [uid]
    );

    console.log('Found', rows.length, 'room postings for uid:', uid);

    // Parse JSON fields with error handling
    const rooms = rows.map(room => ({
      ...room,
      amenities: parseJsonField(room.amenities),
      images: parseJsonField(room.images),
    }));

    res.status(200).json({
      success: true,
      rooms: rooms,
    });
  } catch (error) {
    console.error('Get user rooms error:', error);
    res.status(500).json({ error: error.message || 'Failed to get room postings' });
  } finally {
    if (connection) connection.release();
  }
});

// Get user's room postings (public - no authentication required)
router.get('/user/:uid/public', async (req, res) => {
  let connection;
  try {
    const { uid } = req.params;

    console.log('Getting public room postings for uid:', uid);

    connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT * FROM room_postings WHERE uid = ? AND status = "active" ORDER BY createdAt DESC',
      [uid]
    );

    console.log('Found', rows.length, 'room postings for uid:', uid);

    // Parse JSON fields with error handling
    const rooms = rows.map(room => ({
      ...room,
      amenities: parseJsonField(room.amenities),
      images: parseJsonField(room.images),
    }));

    res.status(200).json({
      success: true,
      rooms: rooms,
    });
  } catch (error) {
    console.error('Get public user rooms error:', error);
    res.status(500).json({ error: error.message || 'Failed to get room postings' });
  } finally {
    if (connection) connection.release();
  }
});

// Get all room postings (for browsing) - UPDATED TO INCLUDE OWNER INFO AND RATINGS
router.get('/', async (req, res) => {
  let connection;
  try {
    const { location, roomType, minPrice, maxPrice, limit = 50, offset = 0 } = req.query;

    connection = await pool.getConnection();
    
    // JOIN with users table AND reviews table to include owner information and ratings
    let query = `SELECT 
      r.id,
      r.uid,
      r.subscriptionId,
      r.title,
      r.description,
      r.price,
      r.location,
      r.address,
      r.roomType,
      r.dimension,
      r.bedroom,
      r.bathroom,
      r.floor,
      r.amenities,
      r.images,
      r.isFree,
      r.status,
      r.createdAt,
      r.updatedAt,
      u.firstName as ownerFirstName,
      u.lastName as ownerLastName,
      u.imageUrl as ownerImageUrl,
      COALESCE(AVG(rev.rating), 0) as ownerRating
    FROM room_postings r
    LEFT JOIN users u ON r.uid = u.uid
    LEFT JOIN reviews rev ON rev.landlordUid = u.uid
    WHERE r.status = "active"`;
    const params = [];

    if (location) {
      query += ' AND r.location = ?';
      params.push(location);
    }

    if (roomType) {
      query += ' AND r.roomType = ?';
      params.push(roomType);
    }

    if (minPrice) {
      query += ' AND (r.price >= ? OR r.isFree = 1)';
      params.push(parseFloat(minPrice));
    }

    if (maxPrice) {
      query += ' AND (r.price <= ? OR r.isFree = 1)';
      params.push(parseFloat(maxPrice));
    }

    // Important: GROUP BY all selected fields to properly aggregate ratings
    query += ` GROUP BY r.id, r.uid, r.subscriptionId, r.title, r.description, r.price, 
               r.location, r.address, r.roomType, r.dimension, r.bedroom, r.bathroom, 
               r.floor, r.amenities, r.images, r.isFree, r.status, r.createdAt, r.updatedAt,
               u.firstName, u.lastName, u.imageUrl`;
    
    query += ' ORDER BY r.createdAt DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await connection.query(query, params);

    // Parse JSON fields with error handling
    const rooms = rows.map(room => ({
      ...room,
      amenities: parseJsonField(room.amenities),
      images: parseJsonField(room.images),
    }));

    console.log(`Found ${rooms.length} rooms with owner info and ratings`);

    res.status(200).json({
      success: true,
      rooms: rooms,
      count: rooms.length,
    });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: error.message || 'Failed to get room postings' });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/:roomId', async (req, res) => {
  let connection;
  try {
    const { roomId } = req.params;

    console.log('Getting room by id:', roomId);

    connection = await pool.getConnection();
    
    // Join with users table to get owner info and calculate average rating
    const [rows] = await connection.query(
      `SELECT 
        r.id,
        r.uid,
        r.title,
        r.description,
        r.price,
        r.location,
        r.address,
        r.roomType,
        r.dimension,
        r.bedroom,
        r.bathroom,
        r.floor,
        r.amenities,
        r.images,
        r.isFree,
        r.status,
        r.createdAt,
        r.updatedAt,
        u.firstName as ownerFirstName,
        u.lastName as ownerLastName,
        u.imageUrl as ownerImageUrl,
        COALESCE(AVG(rev.rating), 0) as ownerRating
      FROM room_postings r
      LEFT JOIN users u ON r.uid = u.uid
      LEFT JOIN reviews rev ON rev.landlordUid = u.uid
      WHERE r.id = ? AND r.status = "active"
      GROUP BY r.id, r.uid, r.title, r.description, r.price, r.location, r.address, 
               r.roomType, r.dimension, r.bedroom, r.bathroom, r.floor, r.amenities, 
               r.images, r.isFree, r.status, r.createdAt, r.updatedAt,
               u.firstName, u.lastName, u.imageUrl`,
      [roomId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = rows[0];
    
    console.log('=== RAW ROOM DATA FROM DB ===');
    console.log('Raw images field:', room.images);
    console.log('Images type:', typeof room.images);
    console.log('Raw amenities field:', room.amenities);
    console.log('Amenities type:', typeof room.amenities);
    console.log('Owner rating:', room.ownerRating);
    console.log('============================');

    // Parse JSON fields and format response
    const roomData = {
      ...room,
      amenities: parseJsonField(room.amenities),
      images: parseJsonField(room.images),
    };
    
    console.log('=== PARSED ROOM DATA ===');
    console.log('Parsed images:', roomData.images);
    console.log('Parsed amenities:', roomData.amenities);
    console.log('Owner rating:', roomData.ownerRating);
    console.log('========================');

    res.status(200).json({
      success: true,
      room: roomData,
    });
  } catch (error) {
    console.error('Get room by id error:', error);
    res.status(500).json({ error: error.message || 'Failed to get room details' });
  } finally {
    if (connection) connection.release();
  }
});

// Delete room posting
router.delete('/:roomId', authenticate, async (req, res) => {
  let connection;
  try {
    const { roomId } = req.params;
    const uid = req.user.uid;

    connection = await pool.getConnection();

    // Verify ownership
    const [rows] = await connection.query(
      'SELECT uid FROM room_postings WHERE id = ?',
      [roomId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Room posting not found' });
    }

    if (rows[0].uid !== uid) {
      return res.status(403).json({ error: 'Forbidden: Cannot delete other user\'s post' });
    }

    // Delete the posting
    await connection.query('DELETE FROM room_postings WHERE id = ?', [roomId]);

    console.log(`Room posting deleted: id=${roomId}, uid=${uid}`);

    res.status(200).json({
      success: true,
      message: 'Room posting deleted successfully',
    });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete room posting' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;