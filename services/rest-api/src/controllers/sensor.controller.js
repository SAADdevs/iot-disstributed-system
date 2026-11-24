const sensorService = require('../services/sensor.service');

async function listSensors(req, res) {
  const sensors = await sensorService.getSensors();
  res.status(200).json(sensors);
}

module.exports = { listSensors };