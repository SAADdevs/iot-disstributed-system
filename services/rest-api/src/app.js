const express = require('express');
const cors = require('cors');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const app = express();

// Middlewares globaux
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'rest-api',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Routes (ghanzidohom f lkhtwat jayin)

// Khass ykono f lakhr, b had tartib
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;