const express = require('express');
const sensorController = require('../controllers/sensor.controller');

const router = express.Router();

router.get('/', sensorController.listSensors);

module.exports = router;