const { queryApi, bucket, measurement } = require('../config/influxdb');

const ACTIVE_MINUTES = Number(process.env.SENSOR_ACTIVE_MINUTES) || 5;
const LOOKBACK = '-30d';

async function getSensors() {
  const flux = `
    from(bucket: "${bucket}")
      |> range(start: ${LOOKBACK})
      |> filter(fn: (r) => r._measurement == "${measurement}")
      |> filter(fn: (r) => r._field == "temperature")
      |> group(columns: ["sensor_id"])
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

  const activeMs = ACTIVE_MINUTES * 60 * 1000;
  const now = Date.now();

  return rows
    .map((row) => {
      const lastSeen = new Date(row._time);
      return {
        sensor_id: row.sensor_id,
        status: now - lastSeen.getTime() <= activeMs ? 'active' : 'inactive',
        last_seen: lastSeen.toISOString(),
      };
    })
    .sort((a, b) => a.sensor_id.localeCompare(b.sensor_id));
}

module.exports = { getSensors };