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

// Middleware: kay-chekki req.query w kay7et natija f res.locals.query
function validateLatestQuery(req, res, next) {
  const { error, value } = latestQuerySchema.validate(req.query, { abortEarly: false });
  if (error) return next(error);
  res.locals.query = value;
  next();
}

module.exports = { validateLatestQuery };