const Joi = require('joi');

const alertsHistorySchema = Joi.object({
  sensor_id: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{1,64}$/)
    .messages({
      'string.pattern.base': 'sensor_id must contain only letters, digits, "-" or "_" (max 64 chars)',
    }),
  from: Joi.date().iso().required(),
  to: Joi.date().iso().greater(Joi.ref('from')).default(() => new Date()),
  limit: Joi.number().integer().min(1).max(500).default(100),
});

function validateAlertsHistoryQuery(req, res, next) {
  const { error, value } = alertsHistorySchema.validate(req.query, { abortEarly: false });
  if (error) return next(error);
  res.locals.query = value;
  next();
}

module.exports = { validateAlertsHistoryQuery };