const express = require('express');
const path = require('path');
const apiRouter = require('./routes/api');
const webRouter = require('./routes/web');
const { getDefaultUser } = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Pinboard-compatible API
app.use('/api/v1', apiRouter);

// Web UI
app.use('/', webRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  const user = getDefaultUser();
  console.log(`Pinbook running at http://localhost:${PORT}`);
  console.log(`API token: ${user.username}:${user.api_token}`);
  console.log(`Database: ${path.join(__dirname, 'data', 'pinbook.db')}`);
});
