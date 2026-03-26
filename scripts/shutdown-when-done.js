const fs = require('fs');
const { execSync } = require('child_process');
const PROGRESS_FILE = 'c:/Users/colby/Repos/master-dashboard/data/family-office-scrape/phase3-progress.json';
const TOTAL = 7019;

function check() {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) {
      console.log('Progress file gone — Phase 3 complete!');
      shutdown();
      return;
    }
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    const completed = data.completed || 0;
    console.log(`${new Date().toLocaleTimeString()} — ${completed}/${TOTAL}`);
    if (completed >= TOTAL) {
      console.log('Phase 3 complete!');
      shutdown();
      return;
    }
  } catch (e) {
    console.log('Error reading progress:', e.message);
  }
  setTimeout(check, 60000);
}

function shutdown() {
  console.log('Shutting down in 30 seconds...');
  setTimeout(() => {
    console.log('Shutting down now.');
    execSync('shutdown /s /t 0');
  }, 30000);
}

check();
