/**
 * Script to add ADMIN_DASHBOARD_URL to .env file if not present
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

// Check if .env exists
if (!fs.existsSync(envPath)) {
  console.log('❌ .env file not found. Please create it from .env.example');
  process.exit(1);
}

// Read current .env content
let envContent = fs.readFileSync(envPath, 'utf8');

// Check if ADMIN_DASHBOARD_URL already exists
if (envContent.includes('ADMIN_DASHBOARD_URL')) {
  console.log('✅ ADMIN_DASHBOARD_URL already exists in .env');
  process.exit(0);
}

// Add ADMIN_DASHBOARD_URL to .env
const newLine = '\n# Admin Dashboard URL for icon management\nADMIN_DASHBOARD_URL=http://localhost:3001\n';
envContent += newLine;

fs.writeFileSync(envPath, envContent);
console.log('✅ Added ADMIN_DASHBOARD_URL=http://localhost:3001 to .env');
