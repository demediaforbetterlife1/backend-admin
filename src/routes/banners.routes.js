/**
 * Promotional banners for the home / voice rooms discovery screens.
 */

const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// Use APP_URL from environment or default to localhost:3000
const appUrl = process.env.APP_URL || 'http://localhost:3000';

const BANNERS = [
  {
    id: 'banner-voice-rooms',
    title: 'Voice Rooms',
    subtitle: 'Discover voice rooms and join the conversation',
    imageUrl: `${appUrl}/api/icon-proxy/navvoicerooms_1787139744106.png`,
    actionType: 'route',
    actionValue: '/app/rooms-discovery',
    sortOrder: 1,
  },
  {
    id: 'banner-create-room',
    title: 'Start Your Room',
    subtitle: 'Create a space and invite your audience',
    imageUrl: `${appUrl}/api/icon-proxy/navhome_1__1787139703087.png`,
    actionType: 'route',
    actionValue: '/app/create-room',
    sortOrder: 2,
  },
  {
    id: 'banner-vip',
    title: 'VIP Privileges',
    subtitle: 'Unlock premium seats, frames & entrances',
    imageUrl: `${appUrl}/api/icon-proxy/navalerts.png`,
    actionType: 'route',
    actionValue: '/app/main-shell',
    sortOrder: 3,
  },
];

router.get('/', authenticate, (req, res) => {
  res.json({ success: true, data: BANNERS });
});

module.exports = router;
