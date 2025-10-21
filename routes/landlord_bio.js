const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // Adjust path if your DB config is elsewhere

// GET /api/landlord-bio/:uid - Fetch bio (public, for own or other profiles)
router.get('/:uid', async (req, res) => {
  const { uid } = req.params;
  try {
    const [rows] = await pool.query('SELECT bio FROM landlord_bios WHERE uid = ?', [uid]);
    if (rows.length > 0) {
      res.json({ bio: rows[0].bio });
    } else {
      res.json({ bio: '' }); // Return empty if no bio exists
    }
  } catch (error) {
    console.error('Error fetching bio:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/landlord-bio/update - Update bio (for landlords editing their own)
// Add auth middleware here if needed, e.g., router.post('/update', authMiddleware, async (req, res) => { ... });
router.post('/update', async (req, res) => {
  const { uid, bio } = req.body;
  if (!uid || bio === undefined) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  try {
    // Upsert: Insert if not exists, update if exists
    await pool.query(
      'INSERT INTO landlord_bios (uid, bio) VALUES (?, ?) ON DUPLICATE KEY UPDATE bio = ?, updated_at = CURRENT_TIMESTAMP',
      [uid, bio, bio]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating bio:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;