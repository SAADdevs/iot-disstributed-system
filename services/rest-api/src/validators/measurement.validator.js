const Joi = require('joi');

const sensorId = Joi.string()
  .pattern(/^[A-Za-z0-9_-]{1,64}$/)
  .required()
  .messages({
    'string.pattern.base': 'sensor_id must contain only letters, digits, "-" or "_" (max 64 chars)',
  });

const latestQuerySchema = Joi.object({
  sensor_id: sensorId,
});

const historyQuerySchema = Joi.object({
  sensor_id: sensorId,
  from: Joi.date().iso().required(),
  to: Joi.date().iso().greater(Joi.ref('from')).default(() => new Date()),
  limit: Joi.number().integer().min(1).max(1000).default(500),
});

// Factory: kay-3ti middleware li kay-chekki req.query b schema m3ayen
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, { abortEarly: false });
    if (error) return next(error);
    // Ma kan-bddlo4 req.query (read-only f Express 5)
    res.locals.query = value;
    next();
  };
}

module.exports = {
  validateLatestQuery: validateQuery(latestQuerySchema),
  validateHistoryQuery: validateQuery(historyQuerySchema),
};