// 404: ay route ma kaynach
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} does not exist`,
  });
}

// Gestion centralisée dyal ga3 les erreurs
// (khass 4 paramètres bach Express ya3rf bli hada error handler)
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Erreurs dyal validation Joi => 400
  if (err.isJoi) {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.details.map((d) => d.message),
    });
  }

    // InfluxDB ma khddmch => 503
  if (err.status === 503) {
    console.error(err.cause || err);
    return res.status(503).json({
      error: 'Service Unavailable',
      message: err.message,
    });
  }

  const status = err.status || err.statusCode || 500;

  // Ma n3rdoch details teqniyin f 500 (sécurité)
  const message = status >= 500 ? 'Internal Server Error' : err.message;

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : 'Bad Request',
    message,
  });
}

module.exports = { notFoundHandler, errorHandler };