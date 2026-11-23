const { queryApi, bucket, measurement } = require('../config/influxdb');

const LOOKBACK = '-30d';
const FIELDS = ['temperature', 'humidity', 'soil_humidity'];

function fieldsFilter() {
  return FIELDS.map((f) => `r._field == "${f}"`).join(' or ');
}

async function runQuery(flux) {
  try {
    return await queryApi.collectRows(flux);
  } catch (err) {
    const error = new Error('InfluxDB is unavailable', { cause: err });
    error.status = 503;
    throw error;
  }
}

async function getLatestMeasurement(sensorId) {
  const flux = `
    from(bucket: "${bucket}")
      |> range(start: ${LOOKBACK})
      |> filter(fn: (r) => r._measurement == "${measurement}")
      |> filter(fn: (r) => r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => ${fieldsFilter()})
      |> last()
  `;

  const rows = await runQuery(flux);

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

async function getMeasurementHistory({ sensorId, from, to, limit }) {
  const start = from.toISOString();
  const stop = to.toISOString();

  const flux = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> filter(fn: (r) => r._measurement == "${measurement}")
      |> filter(fn: (r) => r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => ${fieldsFilter()})
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> group()
      |> sort(columns: ["_time"])
      |> limit(n: ${limit})
  `;

  const rows = await runQuery(flux);

  const measurements = rows.map((row) => ({
    timestamp: new Date(row._time).toISOString(),
    temperature: row.temperature,
    humidity: row.humidity,
    soil_humidity: row.soil_humidity,
  }));

  return {
    sensor_id: sensorId,
    from: start,
    to: stop,
    count: measurements.length,
    measurements,
  };
}

module.exports = { getLatestMeasurement, getMeasurementHistory, runQuery, fieldsFilter, FIELDS };