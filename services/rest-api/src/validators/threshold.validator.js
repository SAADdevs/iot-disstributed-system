const Joi = require('joi');

// min/max b limites s7a7 l kol mesure
function limits(lo, hi) {
  return Joi.object({
    min: Joi.number().min(lo).max(hi),
    max: Joi.number().min(lo).max(hi),
  }).min(1);
}

const thresholdsBodySchema = Joi.object({
  temperature: limits(-40, 80),
  humidity: limits(0, 100),
  soil_humidity: limits(0, 100),
}).min(1);

// Middleware: kay-chekki req.body w kay7et natija f res.locals.body
function validateThresholdsBody(req, res, next) {
  const { error, value } = thresholdsBodySchema.validate(req.body ?? {}, { abortEarly: false });
  if (error) return next(error);
  res.locals.body = value;
  next();
}

module.exports = { validateThresholdsBody };