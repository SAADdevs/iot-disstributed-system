const express = require('express');
const measurementController = require('../controllers/measurement.controller');
const { validateLatestQuery } = require('../validators/measurement.validator');

const router = express.Router();

router.get('/latest', validateLatestQuery, measurementController.getLatest);

module.exports = router;