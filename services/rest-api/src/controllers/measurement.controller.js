const measurementService = require('../services/measurement.service');

async function getLatest(req, res) {
  const { sensor_id } = res.locals.query;
  const data = await measurementService.getLatestMeasurement(sensor_id);
  res.status(200).json(data);
}

module.exports = { getLatest };