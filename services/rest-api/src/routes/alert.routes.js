const express = require('express');
const alertController = require('../controllers/alert.controller');
const { validateAlertsHistoryQuery } = require('../validators/alert.validator');

const router = express.Router();

router.get('/active', alertController.getActive);
router.get('/', validateAlertsHistoryQuery, alertController.getHistory);

module.exports = router;