const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');

// Get reviews for a landlord (PUBLIC - no auth required)
router.get('/:landlordUid', async (req, res) => {
  let connection;
  try {
    const { landlordUid } = req.params;

    console.log('Getting reviews for landlord:', landlordUid);

    connection = await pool.getConnection();
    
    // Get reviews with reviewer information
    const [reviews] = await connection.query(
      `SELECT 
        r.id,
        r.title,
        r.rating,
        r.reviewText,
        r.createdAt,
        u.firstName AS reviewerFirstName,
        u.lastName AS reviewerLastName,
        u.imageUrl AS reviewerImageUrl
      FROM reviews r
      JOIN users u ON r.reviewerUid = u.uid
      WHERE r.landlordUid = ?
      ORDER BY r.createdAt DESC`,
      [landlordUid]
    );

    // Get average rating and count
    const [stats] = await connection.query(
      `SELECT 
        COALESCE(AVG(rating), 0) AS averageRating,
        COUNT(*) AS reviewCount
      FROM reviews
      WHERE landlordUid = ?`,
      [landlordUid]
    );

    console.log('Reviews found:', reviews.length);

    res.status(200).json({
      success: true,
      reviews: reviews,
      stats: {
        averageRating: parseFloat(stats[0].averageRating || 0),
        reviewCount: parseInt(stats[0].reviewCount || 0)
      }
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ error: error.message || 'Failed to get reviews' });
  } finally {
    if (connection) connection.release();
  }
});

// Create a review (requires authentication)
router.post('/', authenticate, async (req, res) => {
  let connection;
  try {
    const { landlordUid, title, rating, reviewText } = req.body;
    const reviewerUid = req.user.uid;

    console.log('Creating review:', { landlordUid, reviewerUid, title, rating });

    // Validation
    if (!landlordUid || !title || !rating || !reviewText) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (rating < 0 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 0 and 5' });
    }

    // Can't review yourself
    if (landlordUid === reviewerUid) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }

    connection = await pool.getConnection();

    // Check if landlord exists
    const [landlordCheck] = await connection.query(
      'SELECT uid FROM users WHERE uid = ?',
      [landlordUid]
    );

    if (landlordCheck.length === 0) {
      return res.status(404).json({ error: 'Landlord not found' });
    }

    // Check if user already reviewed this landlord
    const [existingReview] = await connection.query(
      'SELECT id FROM reviews WHERE landlordUid = ? AND reviewerUid = ?',
      [landlordUid, reviewerUid]
    );

    if (existingReview.length > 0) {
      // Update existing review
      await connection.query(
        `UPDATE reviews 
        SET title = ?, rating = ?, reviewText = ?, updatedAt = NOW()
        WHERE id = ?`,
        [title, rating, reviewText, existingReview[0].id]
      );

      res.status(200).json({
        success: true,
        message: 'Review updated successfully',
        reviewId: existingReview[0].id
      });
    } else {
      // Insert new review
      const [result] = await connection.query(
        `INSERT INTO reviews (landlordUid, reviewerUid, title, rating, reviewText)
        VALUES (?, ?, ?, ?, ?)`,
        [landlordUid, reviewerUid, title, rating, reviewText]
      );

      res.status(201).json({
        success: true,
        message: 'Review created successfully',
        reviewId: result.insertId
      });
    }
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({ error: error.message || 'Failed to create review' });
  } finally {
    if (connection) connection.release();
  }
});

// Update a review (requires authentication and ownership)
router.put('/:reviewId', authenticate, async (req, res) => {
  let connection;
  try {
    const { reviewId } = req.params;
    const { title, rating, reviewText } = req.body;
    const reviewerUid = req.user.uid;

    console.log('Updating review:', reviewId);

    // Validation
    if (rating && (rating < 0 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 0 and 5' });
    }

    connection = await pool.getConnection();

    // Check if review exists and user owns it
    const [reviewCheck] = await connection.query(
      'SELECT reviewerUid FROM reviews WHERE id = ?',
      [reviewId]
    );

    if (reviewCheck.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    if (reviewCheck[0].reviewerUid !== reviewerUid) {
      return res.status(403).json({ error: 'Not authorized to update this review' });
    }

    // Build update query
    const updateFields = [];
    const values = [];

    if (title) {
      updateFields.push('title = ?');
      values.push(title);
    }
    if (rating) {
      updateFields.push('rating = ?');
      values.push(rating);
    }
    if (reviewText) {
      updateFields.push('reviewText = ?');
      values.push(reviewText);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push('updatedAt = NOW()');
    values.push(reviewId);

    await connection.query(
      `UPDATE reviews SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.status(200).json({
      success: true,
      message: 'Review updated successfully'
    });
  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({ error: error.message || 'Failed to update review' });
  } finally {
    if (connection) connection.release();
  }
});

// Delete a review (requires authentication and ownership)
router.delete('/:reviewId', authenticate, async (req, res) => {
  let connection;
  try {
    const { reviewId } = req.params;
    const reviewerUid = req.user.uid;

    console.log('Deleting review:', reviewId);

    connection = await pool.getConnection();

    // Check if review exists and user owns it
    const [reviewCheck] = await connection.query(
      'SELECT reviewerUid FROM reviews WHERE id = ?',
      [reviewId]
    );

    if (reviewCheck.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    if (reviewCheck[0].reviewerUid !== reviewerUid) {
      return res.status(403).json({ error: 'Not authorized to delete this review' });
    }

    await connection.query('DELETE FROM reviews WHERE id = ?', [reviewId]);

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete review' });
  } finally {
    if (connection) connection.release();
  }
});

// Check if user has reviewed a landlord (requires authentication)
router.get('/check/:landlordUid', authenticate, async (req, res) => {
  let connection;
  try {
    const { landlordUid } = req.params;
    const reviewerUid = req.user.uid;

    connection = await pool.getConnection();
    const [result] = await connection.query(
      'SELECT id FROM reviews WHERE landlordUid = ? AND reviewerUid = ?',
      [landlordUid, reviewerUid]
    );

    res.status(200).json({
      success: true,
      hasReviewed: result.length > 0,
      reviewId: result.length > 0 ? result[0].id : null
    });
  } catch (error) {
    console.error('Check review error:', error);
    res.status(500).json({ error: error.message || 'Failed to check review' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;