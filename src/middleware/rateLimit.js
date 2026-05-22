const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    error: 'Too many requests',
    message: 'Rate limit: 10 POST requests per minute',
  }),
});

module.exports = limiter;
