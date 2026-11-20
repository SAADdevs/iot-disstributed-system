#!/usr/bin/env python3
"""Ingest script: reads sensor readings from RabbitMQ and stores them in InfluxDB 2.x.

    simulator -> exchange "sensors" -> queue "influx_ingest" -> THIS SCRIPT -> InfluxDB -> Grafana

The important rule: a message is acknowledged ("ack") to RabbitMQ ONLY AFTER InfluxDB
has accepted the write. If InfluxDB is down, the message is not acknowledged: it goes
back to the queue and stays there, and this script retries with a growing pause
(1s, 2s, 4s ... max 10s). When InfluxDB is back, the backlog is stored, in order.

Each reading becomes one InfluxDB point:

    measurement: sensors
    tag:         sensor_id
    fields:      temperature, humidity, soil_humidity
    time:        the "timestamp" of the message (when the sensor measured it), NOT the
                 time of ingestion, so a backlog keeps its real timeline in Grafana.

Because the point is identified by (measurement, sensor_id, time), receiving the same
message twice (it can happen after a crash) just overwrites the same point: no duplicates.

A message that cannot be understood (not JSON, missing field) is rejected without
requeue and logged: otherwise it would block the queue forever.

Install:  pip install pika influxdb-client

Configuration: environment variables, or a .env file next to this script
(never commit .env: it holds the InfluxDB token).

    INFLUXDB_TOKEN        API token with write access to the bucket    (required)
    INFLUXDB_ORG          organization name or ID                      (required)
    INFLUXDB_BUCKET       bucket to write to                           Distributed_project
    INFLUXDB_URL          InfluxDB address                             http://localhost:8086
    INFLUXDB_MEASUREMENT  measurement name                             sensors
    RABBITMQ_HOST         broker host                                  localhost
    RABBITMQ_PORT         AMQP port                                    5672
    RABBITMQ_USERNAME     broker user                                  guest
    RABBITMQ_PASSWORD     broker password                              guest
    RABBITMQ_VHOST        virtual host                                 /
    RABBITMQ_EXCHANGE     exchange name (same as the simulator)        sensors
    RABBITMQ_QUEUE        queue to read (same as the simulator)        influx_ingest

Stop it with Ctrl+C: messages not yet acknowledged simply stay in the queue.
"""

import json
import logging
import os
import time
import warnings
from datetime import datetime, timezone

import pika
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

# Recent pika versions print a deprecation notice for BlockingConnection. It is still
# the connection class used by all the official RabbitMQ tutorials, so it is hidden.
warnings.filterwarnings("ignore", message="BlockingConnection is deprecated")

log = logging.getLogger("ingest")

FIELDS = ("temperature", "humidity", "soil_humidity")
NETWORK_ERRORS = (pika.exceptions.AMQPError, OSError)


def describe(exc):
    """Short, one-line text for an exception."""
    status = getattr(exc, "status", None)  # InfluxDB HTTP errors (401, 404, ...)
    if status:
        reason = getattr(exc, "reason", "") or ""
        return f"{type(exc).__name__}: HTTP {status} {reason}".strip()
    text = str(exc).strip()
    text = text.splitlines()[0][:200] if text else ""
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__


def reading_to_point(reading, measurement):
    """Turn one decoded JSON reading into an InfluxDB Point (raises on bad data)."""
    point = Point(measurement).tag("sensor_id", str(reading["sensor_id"]))
    for name in FIELDS:
        point.field(name, float(reading[name]))
    stamp = reading.get("timestamp")
    if stamp:
        when = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    else:
        when = datetime.now(timezone.utc)
    return point.time(when, WritePrecision.S)


class Ingester:
    """The message callback: decode, write to InfluxDB, then ack (or nack)."""

    def __init__(self, write_point, measurement, max_backoff=10.0):
        self.write_point = write_point
        self.measurement = measurement
        self.max_backoff = max_backoff
        self.backoff = 1.0
        self.influx_down = False

    def on_message(self, ch, method, properties, body):
        # 1) Understand the message. A broken message can never succeed: drop it.
        try:
            reading = json.loads(body)
            point = reading_to_point(reading, self.measurement)
        except (ValueError, KeyError, TypeError) as exc:
            log.error("Dropping unreadable message %r (%s)", body[:200], describe(exc))
            ch.basic_nack(method.delivery_tag, requeue=False)
            return

        # 2) Store it. If InfluxDB fails, keep the message in RabbitMQ and retry.
        try:
            self.write_point(point)
        except Exception as exc:  # noqa: BLE001 - any write problem means "try again later"
            self.influx_down = True
            log.warning(
                "InfluxDB write failed (%s). Message kept in the queue, retrying in %.0fs",
                describe(exc), self.backoff,
            )
            time.sleep(self.backoff)
            self.backoff = min(self.backoff * 2, self.max_backoff)
            ch.basic_nack(method.delivery_tag, requeue=True)
            return

        # 3) Only now is it safe for RabbitMQ to forget the message.
        ch.basic_ack(method.delivery_tag)
        if self.influx_down:
            log.info("InfluxDB is back: storing the backlog")
            self.influx_down = False
        self.backoff = 1.0
        log.info(
            "stored %s T=%s H=%s soil=%s (%s)",
            reading["sensor_id"], reading["temperature"], reading["humidity"],
            reading["soil_humidity"], reading.get("timestamp", "now"),
        )


def load_env_file():
    """Read KEY=VALUE lines from a .env file next to this script, if there is one.

    Real environment variables win over the file. Keep .env out of git: it holds secrets.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    try:
        with open(path, encoding="utf-8-sig") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        return
    except UnicodeDecodeError:
        raise SystemExit(f"{path} must be saved as UTF-8 (in VS Code: encoding, bottom right)")
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def consume_forever(params, exchange, queue, ingester):
    """Connect to RabbitMQ and consume; reconnect if the connection drops."""
    reported = False
    while True:
        conn = None
        try:
            conn = pika.BlockingConnection(params)
            ch = conn.channel()
            # Same settings as the simulator (declaring twice is harmless, but the
            # settings must match, otherwise RabbitMQ refuses with PRECONDITION_FAILED).
            ch.exchange_declare(exchange=exchange, exchange_type="topic", durable=True)
            ch.queue_declare(queue=queue, durable=True)
            ch.queue_bind(queue=queue, exchange=exchange, routing_key="#")
            # One message at a time: if InfluxDB is down, only one message is "in hand".
            ch.basic_qos(prefetch_count=1)
            ch.basic_consume(queue=queue, on_message_callback=ingester.on_message, auto_ack=False)
            log.info("Connected to RabbitMQ, waiting for messages on queue %r (Ctrl+C to stop)", queue)
            reported = False
            ch.start_consuming()
        except KeyboardInterrupt:
            log.info("Stopping (unacknowledged messages stay in the queue)")
            return
        except NETWORK_ERRORS as exc:
            if not reported:
                log.warning(
                    "RabbitMQ connection problem (%s). Is it running? Retrying every 3s...",
                    describe(exc),
                )
                reported = True
            time.sleep(3)
        finally:
            try:
                if conn is not None and conn.is_open:
                    conn.close()
            except Exception:  # noqa: BLE001 - closing a dead connection may raise anything
                pass


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # pika logs long tracebacks on connection failures; this script reports them itself.
    logging.getLogger("pika").setLevel(logging.CRITICAL)
    load_env_file()

    token = os.getenv("INFLUXDB_TOKEN", "").strip()
    org = os.getenv("INFLUXDB_ORG", "").strip()
    if not token or not org:
        raise SystemExit(
            "INFLUXDB_TOKEN and INFLUXDB_ORG are required. Put them in the .env file "
            "next to this script (see the top of ingest_influx.py)."
        )
    bucket = os.getenv("INFLUXDB_BUCKET", "Distributed_project")
    url = os.getenv("INFLUXDB_URL", "http://localhost:8086")
    measurement = os.getenv("INFLUXDB_MEASUREMENT", "sensors")

    try:
        rabbit_port = int(os.getenv("RABBITMQ_PORT", "5672").strip() or "5672")
    except ValueError:
        raise SystemExit("RABBITMQ_PORT must be a number")
    params = pika.ConnectionParameters(
        host=os.getenv("RABBITMQ_HOST", "localhost"),
        port=rabbit_port,
        virtual_host=os.getenv("RABBITMQ_VHOST", "/"),
        credentials=pika.PlainCredentials(
            os.getenv("RABBITMQ_USERNAME", "guest"), os.getenv("RABBITMQ_PASSWORD", "guest")
        ),
        heartbeat=60,
        connection_attempts=1,
        socket_timeout=5,
        blocked_connection_timeout=30,
    )
    exchange = os.getenv("RABBITMQ_EXCHANGE", "sensors")
    queue = os.getenv("RABBITMQ_QUEUE", "influx_ingest")

    # timeout is in milliseconds: fail fast when InfluxDB is down instead of hanging.
    client = InfluxDBClient(url=url, token=token, org=org, timeout=5000)
    # SYNCHRONOUS: write() returns only when InfluxDB answered, and raises on failure.
    # That is what lets us ack only after a successful write.
    write_api = client.write_api(write_options=SYNCHRONOUS)

    def write_point(point):
        write_api.write(bucket=bucket, record=point)

    log.info("Writing to InfluxDB %s (org %s, bucket %s)", url, org, bucket)
    try:
        consume_forever(params, exchange, queue, Ingester(write_point, measurement))
    finally:
        client.close()


if __name__ == "__main__":
    main()
