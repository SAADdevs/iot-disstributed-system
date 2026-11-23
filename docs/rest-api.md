# REST API: Documentation

Service: `rest-api` (Node.js + Express). It reads measurements from InfluxDB and exposes them over HTTP/JSON.

## Base URL

| From where | URL |
|---|---|
| Your PC (browser, curl) | `http://localhost:3000` |
| Another container in the same Docker Compose network | `http://rest-api:3000` |

> Between containers, never use `localhost`: use the service name `rest-api`.

## Conventions

- All responses are JSON.
- Timestamps are ISO 8601 in UTC, e.g. `2026-11-20T13:15:00.000Z`.
- `sensor_id` accepts only letters, digits, `-` and `_` (max 64 chars), e.g. `esp32-01`.
- Measured values: `temperature` (°C), `humidity` (%), `soil_humidity` (%).

## Error format

| Status | When | Body |
|---|---|---|
| 400 | Invalid or missing parameter | `{"error":"Validation Error","details":["\"from\" is required"]}` |
| 400 | Business rule broken (e.g. min > max) | `{"error":"Bad Request","message":"temperature: min (50) must be <= max (40)"}` |
| 404 | Route or sensor not found | `{"error":"Not Found","message":"..."}` |
| 503 | InfluxDB is unreachable | `{"error":"Service Unavailable","message":"InfluxDB is unavailable"}` |
| 500 | Unexpected error | `{"error":"Internal Server Error","message":"Internal Server Error"}` |

On 503 the API itself is alive: retry later. `/health` keeps answering 200.

---

## GET /health

Is the API alive? Does not touch InfluxDB.

```bash
curl http://localhost:3000/health
```

```json
{"status":"ok","service":"rest-api","uptime_seconds":265,"timestamp":"2026-11-20T13:15:00.000Z"}
```

---

## GET /api/sensors

List of known sensors (seen in the last 30 days). A sensor is `active` if it sent a measurement in the last 5 minutes (`SENSOR_ACTIVE_MINUTES`), otherwise `inactive`.

```bash
curl http://localhost:3000/api/sensors
```

```json
[
  {"sensor_id":"esp32-01","status":"active","last_seen":"2026-11-20T13:45:47.000Z"},
  {"sensor_id":"esp32-02","status":"inactive","last_seen":"2026-11-20T13:36:33.000Z"}
]
```

Errors: 503.

---

## GET /api/measurements/latest

Latest measurement of one sensor.

| Parameter | Required | Description |
|---|---|---|
| `sensor_id` | yes | Sensor identifier |

```bash
curl "http://localhost:3000/api/measurements/latest?sensor_id=esp32-01"
```

```json
{
  "sensor_id": "esp32-01",
  "temperature": 22.2,
  "humidity": 53.1,
  "soil_humidity": 47.1,
  "timestamp": "2026-11-20T13:15:00.000Z"
}
```

Errors: 400 (missing/invalid `sensor_id`), 404 (no data for this sensor), 503.

---

## GET /api/measurements/history

Measurements of one sensor over a period, oldest first.

| Parameter | Required | Description |
|---|---|---|
| `sensor_id` | yes | Sensor identifier |
| `from` | yes | Start, ISO 8601 (e.g. `2026-11-20T13:00:00Z`) |
| `to` | no | End, must be after `from`. Default: now |
| `limit` | no | Max number of measurements. Default 500, max 1000 |

```bash
curl "http://localhost:3000/api/measurements/history?sensor_id=esp32-01&from=2026-11-20T13:00:00Z&limit=2"
```

```json
{
  "sensor_id": "esp32-01",
  "from": "2026-11-20T13:00:00.000Z",
  "to": "2026-11-20T14:00:00.000Z",
  "count": 2,
  "measurements": [
    {"timestamp":"2026-11-20T13:00:02.000Z","temperature":22.2,"humidity":53.1,"soil_humidity":47.1},
    {"timestamp":"2026-11-20T13:00:04.000Z","temperature":21.8,"humidity":53.5,"soil_humidity":47.2}
  ]
}
```

A sensor with no data in the period returns 200 with `"count":0,"measurements":[]`.

Errors: 400, 503.

---

## GET /api/thresholds

Current alert thresholds. Defaults are used until someone changes them.

```bash
curl http://localhost:3000/api/thresholds
```

```json
{
  "temperature":   {"min": 5,  "max": 35},
  "humidity":      {"min": 20, "max": 90},
  "soil_humidity": {"min": 20, "max": 100}
}
```

## PUT /api/thresholds

Update thresholds. The body is **merged** with the current values: send only what changes.

| Metric | Allowed range for `min` / `max` |
|---|---|
| `temperature` | -40 to 80 |
| `humidity` | 0 to 100 |
| `soil_humidity` | 0 to 100 |

```bash
curl -X PUT http://localhost:3000/api/thresholds \
  -H "Content-Type: application/json" \
  -d '{"temperature":{"max":40}}'
```

Returns 200 with the full thresholds after the update. Values are stored in a Docker volume and survive container restarts.

Errors: 400 (unknown metric, value out of range, empty body, or `min` > `max`).

---

## GET /api/alerts/active

Alerts that are active **now**: for each sensor, the latest value (last 5 minutes) is compared to the thresholds. Alerts are computed on the fly, they are not stored.

```bash
curl http://localhost:3000/api/alerts/active
```

```json
{
  "checked_at": "2026-11-20T14:00:00.000Z",
  "window_minutes": 5,
  "sensors_checked": 3,
  "count": 1,
  "alerts": [
    {
      "sensor_id": "esp32-03",
      "metric": "temperature",
      "type": "above_max",
      "value": 36.2,
      "threshold": 35,
      "timestamp": "2026-11-20T13:59:58.000Z"
    }
  ]
}
```

`type` is `above_max` (value > max) or `below_min` (value < min).

Errors: 503.

## GET /api/alerts

History of alerts over a period (measurements outside the **current** thresholds), newest first.

| Parameter | Required | Description |
|---|---|---|
| `from` | yes | Start, ISO 8601 |
| `to` | no | End, must be after `from`. Default: now |
| `sensor_id` | no | Only this sensor. Default: all sensors |
| `limit` | no | Max alerts returned. Default 100, max 500 |

```bash
curl "http://localhost:3000/api/alerts?from=2026-11-20T13:00:00Z&sensor_id=esp32-01&limit=5"
```

```json
{
  "from": "2026-11-20T13:00:00.000Z",
  "to": "2026-11-20T14:00:00.000Z",
  "count": 1,
  "alerts": [
    {"sensor_id":"esp32-01","metric":"temperature","type":"above_max","value":36.2,"threshold":35,"timestamp":"2026-11-20T13:59:58.000Z"}
  ]
}
```

Errors: 400, 503.

---

## Example: calling the API from Python (e.g. Telegram bot)

```python
import os
import requests

API_URL = os.getenv("REST_API_URL", "http://rest-api:3000")  # inside Docker Compose

def get_active_alerts():
    r = requests.get(f"{API_URL}/api/alerts/active", timeout=5)
    if r.status_code == 503:
        return None  # InfluxDB is down: try again later
    r.raise_for_status()
    return r.json()["alerts"]

def get_latest(sensor_id):
    r = requests.get(f"{API_URL}/api/measurements/latest",
                     params={"sensor_id": sensor_id}, timeout=5)
    if r.status_code == 404:
        return None  # unknown sensor
    r.raise_for_status()
    return r.json()

for a in get_active_alerts() or []:
    print(f"WARNING {a['sensor_id']}: {a['metric']}={a['value']} ({a['type']}, threshold {a['threshold']})")
```

Always set a `timeout` and handle 503: the API stays up when InfluxDB is down.