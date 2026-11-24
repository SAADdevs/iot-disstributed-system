const thresholdService = require('../services/threshold.service');

async function getThresholds(req, res) {
  const thresholds = await thresholdService.readThresholds();
  res.status(200).json(thresholds);
}

async function putThresholds(req, res) {
  const thresholds = await thresholdService.updateThresholds(res.locals.body);
  res.status(200).json(thresholds);
}

module.exports = { getThresholds, putThresholds };