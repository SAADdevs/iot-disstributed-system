const express = require('express');
const thresholdController = require('../controllers/threshold.controller');
const { validateThresholdsBody } = require('../validators/threshold.validator');

const router = express.Router();

router.get('/', thresholdController.getThresholds);
router.put('/', validateThresholdsBody, thresholdController.putThresholds);

module.exports = router;