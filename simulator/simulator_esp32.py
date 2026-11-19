#!/usr/bin/env python3
"""Sensor simulator: plays the role of the ESP32 with its three sensors
(temperature, air humidity, soil humidity) and sends the readings to RabbitMQ.

    this script -> exchange "sensors" -> queue "influx_ingest" -> ingest_influx.py -> InfluxDB

Every PUBLISH_INTERVAL seconds, each simulated device sends one JSON message:

    {"sensor_id": "esp32-01", "timestamp": "2026-11-19T19:40:12Z",
     "temperature": 23.4, "humidity": 52.1, "soil_humidity": 48.7}

Units: temperature in degrees C, humidity and soil_humidity in percent.

Install:  pip install pika
Run:      python simulator_rabbitmq.py        (Ctrl+C to stop)

Settings can be put in a file named .env next to this script (never commit it):

    RABBITMQ_HOST=localhost     address of RabbitMQ
    RABBITMQ_PORT=5672          AMQP port (15672 is the web page, not this one)
    RABBITMQ_USERNAME=guest
    RABBITMQ_PASSWORD=guest
    SENSOR_COUNT=1              number of simulated devices
    PUBLISH_INTERVAL=2          seconds between two readings
"""

import json
import logging
import math
import os
import random
import time
import warnings
from datetime import datetime, timezone

import pika

# Newer pika versions print a deprecation notice for BlockingConnection. It is still
# the class used in all the official RabbitMQ tutorials, so the notice is hidden.
warnings.filterwarnings("ignore", message="BlockingConnection is deprecated")

log = logging.getLogger("simulator")

# Fixed settings. ingest_influx.py must use the same exchange and queue names.
EXCHANGE = "sensors"
QUEUE = "influx_ingest"
DAY_SECONDS = 600         # real seconds for one simulated day/night cycle
SENSOR_PREFIX = "esp32"   # devices are called esp32-01, esp32-02, ...

# Physical limits of a DHT11 (0-50 C, 20-90 %RH). Soil moisture is a plain percentage.
TEMP_RANGE = (0.0, 50.0)
HUM_RANGE = (20.0, 90.0)
SOIL_RANGE = (0.0, 100.0)

# Errors that mean "RabbitMQ is unreachable or the connection dropped".
NETWORK_ERRORS = (pika.exceptions.AMQPError, OSError)


def clamp(value, low, high):
    return max(low, min(high, value))


class SensorSim:
    """Produces plausible, smoothly changing readings for ONE device."""

    def __init__(self, sensor_id):
        self.sensor_id = sensor_id
        # Each device sits in a slightly different place.
        self.base_temp = random.uniform(20.0, 25.0)
        self.phase = random.uniform(0.0, 2 * math.pi)
        self.temp_noise = 0.0
        self.hum_noise = 0.0
        self.soil = random.uniform(40.0, 70.0)

    def read(self, t):
        """Return one reading (a dict), t = seconds since the simulator started."""
        # Temperature: day/night cycle + slowly wandering noise.
        daily = math.sin(2 * math.pi * t / DAY_SECONDS + self.phase)
        self.temp_noise = 0.8 * self.temp_noise + random.gauss(0, 0.3)
        temp = self.base_temp + 4.0 * daily + self.temp_noise

        # Air humidity: drops when it is warmer, rises when it is cooler.
        self.hum_noise = 0.8 * self.hum_noise + random.gauss(0, 1.0)
        hum = 55.0 - 1.5 * (temp - 22.0) + self.hum_noise

        # Soil humidity: dries out slowly, gets "watered" now and then.
        self.soil -= random.uniform(0.02, 0.12)
        self.soil += random.gauss(0, 0.1)
        if self.soil < 25.0 and random.random() < 0.05:
            self.soil = random.uniform(60.0, 80.0)

        return {
            "sensor_id": self.sensor_id,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "temperature": round(clamp(temp, *TEMP_RANGE), 1),
            "humidity": round(clamp(hum, *HUM_RANGE), 1),
            "soil_humidity": round(clamp(self.soil, *SOIL_RANGE), 1),
        }


def prepare_rabbitmq(channel):
    """Create the exchange, the queue and the link between them (harmless if they exist)."""
    # durable=True: they survive a RabbitMQ restart.
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    channel.queue_declare(queue=QUEUE, durable=True)
    # "#" means: every message sent to the exchange ends up in the queue.
    # The queue is created here so messages are kept even if the ingest script is off.
    channel.queue_bind(queue=QUEUE, exchange=EXCHANGE, routing_key="#")
    # RabbitMQ confirms each message, and publishing raises an error if it cannot keep it.
    channel.confirm_delivery()


def send(channel, reading):
    """Publish one reading as a JSON message."""
    channel.basic_publish(
        exchange=EXCHANGE,
        routing_key=f"sensors.{reading['sensor_id']}.data",
        body=json.dumps(reading),
        # delivery_mode=2: the message is written to disk (survives a RabbitMQ restart).
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
        # mandatory=True: an error instead of a silent loss if no queue would get it.
        mandatory=True,
    )


def close_quietly(connection):
    try:
        if connection is not None and connection.is_open:
            connection.close()
    except NETWORK_ERRORS:
        pass  # already dead, nothing to close


def load_env_file():
    """Read KEY=VALUE lines from the .env file next to this script, if there is one."""
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
        # Real environment variables win over the file.
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("pika").setLevel(logging.CRITICAL)  # mute pika's long error logs
    load_env_file()

    host = os.getenv("RABBITMQ_HOST") or "localhost"
    port = int(os.getenv("RABBITMQ_PORT") or 5672)
    username = os.getenv("RABBITMQ_USERNAME") or "guest"
    password = os.getenv("RABBITMQ_PASSWORD") or "guest"
    sensor_count = int(os.getenv("SENSOR_COUNT") or 1)
    interval = float(os.getenv("PUBLISH_INTERVAL") or 2)

    sensors = [SensorSim(f"{SENSOR_PREFIX}-{i:02d}") for i in range(1, sensor_count + 1)]
    params = pika.ConnectionParameters(
        host=host,
        port=port,
        credentials=pika.PlainCredentials(username, password),
        connection_attempts=1,
        socket_timeout=5,
    )
    log.info("Simulating %d device(s), one reading every %ss", sensor_count, interval)

    start = time.monotonic()
    while True:  # outer loop: (re)connect to RabbitMQ
        connection = None
        try:
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            prepare_rabbitmq(channel)
            log.info("Connected to RabbitMQ at %s:%s", host, port)

            while True:  # inner loop: one reading per device, then wait
                t = time.monotonic() - start
                for sensor in sensors:
                    reading = sensor.read(t)
                    send(channel, reading)
                    log.info(
                        "%s T=%.1f H=%.1f soil=%.1f",
                        reading["sensor_id"],
                        reading["temperature"],
                        reading["humidity"],
                        reading["soil_humidity"],
                    )
                connection.sleep(interval)  # like time.sleep, but keeps the connection alive

        except NETWORK_ERRORS as exc:
            log.warning("RabbitMQ problem: %r. Is it running? Retrying in 3 seconds...", exc)
            time.sleep(3)
        finally:
            close_quietly(connection)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:  # Ctrl+C
        print("Stopped")
