const express = require('express');
const measurementController = require('../controllers/measurement.controller');
const {
  validateLatestQuery,
  validateHistoryQuery,
} = require('../validators/measurement.validator');

const router = express.Router();

router.get('/latest', validateLatestQuery, measurementController.getLatest);
router.get('/history', validateHistoryQuery, measurementController.getHistory);

module.exports = router;