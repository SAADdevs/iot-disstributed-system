// 404: ay route ma kaynach
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} does not exist`,
  });
}

const ERROR_LABELS = {
  400: 'Bad Request',
  404: 'Not Found',
  503: 'Service Unavailable',
};

// Gestion centralisée dyal ga3 les erreurs
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Erreurs dyal validation Joi => 400
  if (err.isJoi) {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.details.map((d) => d.message),
    });
  }

  const status = err.status || err.statusCode || 500;

  // Ma n3rdoch details teqniyin f 5xx (sécurité), ghir f console
  if (status >= 500) {
    console.error(err.cause || err);
  }

  const message = status === 503 ? err.message : status >= 500 ? 'Internal Server Error' : err.message;

  res.status(status).json({
    error: ERROR_LABELS[status] || (status >= 500 ? 'Internal Server Error' : 'Error'),
    message,
  });
}

module.exports = { notFoundHandler, errorHandler };