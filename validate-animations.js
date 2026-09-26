const https = require('https');

const animations = [
  { name: 'Rose', url: 'https://voicechat-backend.fly.dev/public/animations/rose.json' },
  { name: 'Heart', url: 'https://voicechat-backend.fly.dev/public/animations/heart.json' },
  { name: 'Star', url: 'https://voicechat-backend.fly.dev/public/animations/star.json' },
  { name: 'Diamond', url: 'https://voicechat-backend.fly.dev/public/animations/diamond.json' },
  { name: 'Dragon', url: 'https://voicechat-backend.fly.dev/public/animations/dragon.json' },
  { name: 'Crown', url: 'https://voicechat-backend.fly.dev/public/animations/crown.json' }
];

function fetchAndValidate(url, name) {
  return new Promise((resolve) => {
    console.log(`\n=== ${name} ===`);
    console.log(`URL: ${url}`);
    
    https.get(url, (res) => {
      console.log(`Status: ${res.statusCode}`);
      console.log(`Content-Type: ${res.headers['content-type']}`);
      console.log(`Content-Length: ${res.headers['content-length']}`);
      console.log(`CORS Header: ${res.headers['access-control-allow-origin'] || 'MISSING'}`);
      
      if (res.statusCode !== 200) {
        console.log(`❌ HTTP ${res.statusCode} - Not OK`);
        resolve({ name, valid: false, error: `HTTP ${res.statusCode}` });
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`Response length: ${data.length} bytes`);
        console.log(`First 200 chars: ${data.substring(0, 200)}`);
        
        // Check if it's HTML (error page)
        if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
          console.log(`❌ Response is HTML, not JSON!`);
          resolve({ name, valid: false, error: 'HTML response instead of JSON' });
          return;
        }
        
        // Try to parse as JSON
        try {
          const json = JSON.parse(data);
          
          // Validate Lottie JSON structure
          const hasVersion = json.v !== undefined;
          const hasFrameRate = json.fr !== undefined;
          const hasLayers = Array.isArray(json.layers);
          const hasWidth = json.w !== undefined;
          const hasHeight = json.h !== undefined;
          
          console.log(`JSON parsed: ✅`);
          console.log(`  - Version (v): ${json.v || 'MISSING'}`);
          console.log(`  - Frame rate (fr): ${json.fr || 'MISSING'}`);
          console.log(`  - Width (w): ${json.w || 'MISSING'}`);
          console.log(`  - Height (h): ${json.h || 'MISSING'}`);
          console.log(`  - Layers: ${json.layers ? json.layers.length : 'MISSING'}`);
          console.log(`  - Name (nm): ${json.nm || 'none'}`);
          
          if (!hasVersion || !hasFrameRate || !hasLayers) {
            console.log(`⚠️  Missing required Lottie properties`);
            resolve({ 
              name, 
              valid: false, 
              error: 'Invalid Lottie structure',
              json: json
            });
            return;
          }
          
          console.log(`✅ Valid Lottie JSON`);
          resolve({ 
            name, 
            valid: true, 
            size: data.length,
            version: json.v,
            frameRate: json.fr,
            layers: json.layers.length,
            animationName: json.nm
          });
          
        } catch (err) {
          console.log(`❌ JSON parse error: ${err.message}`);
          console.log(`Last 100 chars: ${data.substring(data.length - 100)}`);
          resolve({ name, valid: false, error: `JSON parse error: ${err.message}` });
        }
      });
    }).on('error', (err) => {
      console.log(`❌ Network error: ${err.message}`);
      resolve({ name, valid: false, error: `Network error: ${err.message}` });
    });
  });
}

async function validateAll() {
  console.log('=== Validating All Gift Animations ===');
  
  const results = [];
  for (const anim of animations) {
    const result = await fetchAndValidate(anim.url, anim.name);
    results.push(result);
  }
  
  console.log('\n\n=== SUMMARY ===\n');
  
  const valid = results.filter(r => r.valid);
  const invalid = results.filter(r => !r.valid);
  
  console.log(`✅ Valid: ${valid.length}/6`);
  valid.forEach(r => {
    console.log(`   - ${r.name}: ${r.size} bytes, ${r.layers} layers, v${r.version}`);
  });
  
  if (invalid.length > 0) {
    console.log(`\n❌ Invalid: ${invalid.length}/6`);
    invalid.forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  }
  
  if (invalid.length === 0) {
    console.log('\n🎉 All animations are valid Lottie JSON files!');
  } else {
    console.log('\n⚠️  Some animations need to be fixed!');
  }
}

validateAll();
