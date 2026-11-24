const { InfluxDB } = require('@influxdata/influxdb-client');

const url = process.env.INFLUX_URL;
const token = process.env.INFLUX_TOKEN;
const org = process.env.INFLUX_ORG;
const bucket = process.env.INFLUX_BUCKET;
const measurement = process.env.INFLUX_MEASUREMENT || 'sensor_data';

// timeout 5s: ila InfluxDB ma jaweb4, ma nb9awch nstnaw l'abad
const influxDB = new InfluxDB({ url, token, timeout: 5000 });
const queryApi = influxDB.getQueryApi(org);

module.exports = { queryApi, bucket, measurement };