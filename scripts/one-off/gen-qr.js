const QRCode = require('qrcode');
const url = 'https://granitepark.co/yacht-checkin-page';
QRCode.toFile('data/qr-march18-ghl.png', url, {
  width: 800,
  margin: 2,
  color: { dark: '#0f0f23', light: '#ffffff' }
}, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log('QR code saved to data/qr-march18-ghl.png for URL:', url);
});
