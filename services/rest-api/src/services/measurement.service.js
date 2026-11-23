const { queryApi, bucket, measurement } = require('../config/influxdb');

const LOOKBACK = '-30d';
const FIELDS = ['temperature', 'humidity', 'soil_humidity'];

async function getLatestMeasurement(sensorId) {
  const fieldsFilter = FIELDS.map((f) => `r._field == "${f}"`).join(' or ');

  const flux = `
    from(bucket: "${bucket}")
      |> range(start: ${LOOKBACK})
      |> filter(fn: (r) => r._measurement == "${measurement}")
      |> filter(fn: (r) => r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => ${fieldsFilter})
      |> last()
  `;

  let rows;
  try {
    rows = await queryApi.collectRows(flux);
  } catch (err) {
    const error = new Error('InfluxDB is unavailable', { cause: err });
    error.status = 503;
    throw error;
  }

  if (rows.length === 0) {
    const error = new Error(`No measurements found for sensor_id "${sensorId}"`);
    error.status = 404;
    throw error;
  }

  const result = { sensor_id: sensorId };
  let latest = 0;

  for (const row of rows) {
    result[row._field] = row._value;
    latest = Math.max(latest, new Date(row._time).getTime());
  }
  result.timestamp = new Date(latest).toISOString();

  return result;
}

module.exports = { getLatestMeasurement };