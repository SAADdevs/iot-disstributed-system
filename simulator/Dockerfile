FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY simulator_esp32.py .

CMD ["python", "-u", "simulator_esp32.py"]