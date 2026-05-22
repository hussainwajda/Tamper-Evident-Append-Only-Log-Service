function authMiddleware(req, res, next) {
  const apiKey = req.get('x-api-key');

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required in x-api-key header',
    });
  }

  return next();
}

module.exports = authMiddleware;
