const express = require('express');
const cors = require('cors');
const sensorRoutes = require('./routes/sensor.routes');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'rest-api',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api/sensors', sensorRoutes);

// Khass ykono f lakhr
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;