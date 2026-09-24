const https = require('https');

async function testSvgUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Testing: ${url}`);
        console.log(`Status: ${res.statusCode}`);
        console.log(`Content-Type: ${res.headers['content-type']}`);
        console.log(`Content-Length: ${res.headers['content-length']}`);
        console.log(`First 200 chars: ${data.substring(0, 200)}`);
        console.log(`Valid SVG: ${data.includes('<svg')}`);
        console.log('');
        resolve({ status: res.statusCode, contentType: res.headers['content-type'], validSvg: data.includes('<svg') });
      });
    }).on('error', reject);
  });
}

async function testAllNavIcons() {
  const urls = [
    'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/home.svg',
    'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/microphone.svg',
    'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/camera.svg',
    'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/account.svg'
  ];
  
  for (const url of urls) {
    await testSvgUrl(url);
  }
}

testAllNavIcons().catch(err => console.error('Error:', err));