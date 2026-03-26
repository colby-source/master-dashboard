// Reads cookies.json and appends LINKEDIN_COOKIES_JSON to .env
const fs = require('fs');
const path = require('path');

const cookiesPath = path.join(__dirname, '..', 'data', 'linkedin-cookies.json');
const envPath = path.join(__dirname, '..', '.env');

if (!fs.existsSync(cookiesPath)) {
  console.error('Place your exported cookies at data/linkedin-cookies.json first');
  process.exit(1);
}

const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
const minified = JSON.stringify(cookies);

let envContent = fs.readFileSync(envPath, 'utf8');

// Remove existing LINKEDIN_COOKIES_JSON line if present
envContent = envContent.replace(/\nLINKEDIN_COOKIES_JSON=.*/, '');

// Append
envContent += `\nLINKEDIN_COOKIES_JSON=${minified}\n`;

fs.writeFileSync(envPath, envContent);
console.log(`Added LINKEDIN_COOKIES_JSON to .env (${cookies.length} cookies, ${minified.length} chars)`);
