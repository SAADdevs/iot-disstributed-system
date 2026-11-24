const { bucket, measurement } = require('../config/influxdb');
const { runQuery, fieldsFilter, FIELDS } = require('./measurement.service');
const { readThresholds } = require('./threshold.service');

const ACTIVE_MINUTES = Number(process.env.SENSOR_ACTIVE_MINUTES) || 5;
const MAX_ROWS = 10000; // max mesures li kan9ra f history

// Kat9arn valeurs m3a thresholds, w kat-rjj3 lista dyal violations
function evaluate(values, thresholds) {
  const found = [];
  for (const metric of FIELDS) {
    const value = values[metric];
    const limit = thresholds[metric];
    if (typeof value !== 'number' || !limit) continue;

    if (limit.max !== undefined && value > limit.max) {
      found.push({ metric, type: 'above_max', value, threshold: limit.max });
    } else if (limit.min !== undefined && value < limit.min) {
      found.push({ metric, type: 'below_min', value, threshold: limit.min });
    }
  }
  return found;
}

async function getActiveAlerts() {
  const thresholds = await readThresholds();

  const flux = `
    from(bucket: "${bucket}")
      |> range(start: -${ACTIVE_MINUTES}m)
      |> filter(fn: (r) => r._measurement == "${measurement}")
      |> filter(fn: (r) => ${fieldsFilter()})
      |> group(columns: ["sensor_id", "_field"])
      |> last()
  `;
  const rows = await runQuery(flux);

  // Nrtbo rows b sensor: {values: {temperature: .., ...}, times: {temperature: .., ...}}
  const bySensor = new Map();
  for (const row of rows) {
    const entry = bySensor.get(row.sensor_id) || { values: {}, times: {} };
    entry.values[row._field] = row._value;
    entry.times[row._field] = new Date(row._time).toISOString();
    bySensor.set(row.sensor_id, entry);
  }

  const alerts = [];
  for (const [sensorId, entry] of bySensor) {
    for (const v of evaluate(entry.values, thresholds)) {
      alerts.push({
        sensor_id: sensorId,
        metric: v.metric,
        type: v.type,
        value: v.value,
        threshold: v.threshold,
        timestamp: entry.times[v.metric],
      });
    }
  }

  alerts.sort(
    (a, b) => a.sensor_id.localeCompare(b.sensor_id) || a.metric.localeCompare(b.metric),
  );

  return {
    checked_at: new Date().toISOString(),
    window_minutes: ACTIVE_MINUTES,
    sensors_checked: bySensor.size,
    count: alerts.length,
    alerts,
  };
}

async function getAlertHistory({ sensorId, from, to, limit }) {
  const thresholds = await readThresholds();
  const start = from.toISOString();
  const stop = to.toISOString();
  const sensorFilter = sensorId
    ? `|> filter(fn: (r) => r.sensor_id == "${sensorId}")`
    : '';

  const flux = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> filter(fn: (r) => r._measurement == "${measurement}")
      ${sensorFilter}
      |> filter(fn: (r) => ${fieldsFilter()})
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> group()
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${MAX_ROWS})
  `;
  const rows = await runQuery(flux);

  // Rows mrtbin mn l'jdid l l'a9dam: kan-w93fo melli nwslo l limit
  const alerts = [];
  for (const row of rows) {
    for (const v of evaluate(row, thresholds)) {
      alerts.push({
        sensor_id: row.sensor_id,
        metric: v.metric,
        type: v.type,
        value: v.value,
        threshold: v.threshold,
        timestamp: new Date(row._time).toISOString(),
      });
    }
    if (alerts.length >= limit) break;
  }

  return {
    from: start,
    to: stop,
    count: Math.min(alerts.length, limit),
    alerts: alerts.slice(0, limit),
  };
}

module.exports = { getActiveAlerts, getAlertHistory };