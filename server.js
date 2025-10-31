import app from './app.js';

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0'; 

app.listen(PORT, HOST, () => {
  console.log(`✅ PTAS API running at http://${HOST}:${PORT}`);
});
