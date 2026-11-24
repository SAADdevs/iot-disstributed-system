const alertService = require('../services/alert.service');

async function getActive(req, res) {
  const data = await alertService.getActiveAlerts();
  res.status(200).json(data);
}

async function getHistory(req, res) {
  const { sensor_id, from, to, limit } = res.locals.query;
  const data = await alertService.getAlertHistory({
    sensorId: sensor_id,
    from,
    to,
    limit,
  });
  res.status(200).json(data);
}

module.exports = { getActive, getHistory };