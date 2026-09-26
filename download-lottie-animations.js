const https = require('https');
const fs = require('fs');
const path = require('path');

const animations = [
  { name: 'rose', url: 'https://assets7.lottiefiles.com/packages/lf20_hy4txm3s.json' },
  { name: 'heart', url: 'https://assets5.lottiefiles.com/packages/lf20_wd1udlcz.json' },
  { name: 'star', url: 'https://assets10.lottiefiles.com/packages/lf20_wsdvq1oj.json' },
  { name: 'diamond', url: 'https://assets10.lottiefiles.com/packages/lf20_fwnpaqxb.json' },
  { name: 'dragon', url: 'https://assets4.lottiefiles.com/packages/lf20_jk6c1n2n.json' },
  { name: 'crown', url: 'https://assets9.lottiefiles.com/packages/lf20_l01ipg5c.json' }
];

const outputDir = path.join(__dirname, 'public', 'animations');

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${filename} from ${url}...`);
    
    https.get(url, (res) => {
      if (res.statusCode === 200) {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          const filepath = path.join(outputDir, filename);
          fs.writeFileSync(filepath, data, 'utf8');
          console.log(`✅ Saved: ${filename} (${data.length} bytes)`);
          
          // Parse JSON to check content and verify it's valid
          try {
            const json = JSON.parse(data);
            console.log(`   Animation name in JSON: ${json.nm || 'unnamed'}`);
            console.log(`   Frames: ${json.op - json.ip || 'unknown'}`);
            resolve({ filename, content: json });
          } catch (err) {
            console.warn(`⚠️  ${filename} is not valid JSON`);
            resolve({ filename, content: null });
          }
        });
      } else {
        console.error(`❌ HTTP ${res.statusCode} for ${url}`);
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    }).on('error', (err) => {
      console.error(`❌ Download error for ${url}:`, err.message);
      reject(err);
    });
  });
}

async function downloadAll() {
  console.log('=== Downloading Lottie Animations ===\n');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const results = [];
  
  for (const anim of animations) {
    try {
      const result = await downloadFile(anim.url, `${anim.name}.json`);
      results.push({ ...anim, ...result });
    } catch (err) {
      console.error(`Failed to download ${anim.name}:`, err.message);
    }
  }
  
  console.log('\n=== Download Summary ===');
  console.log(`Total: ${results.length}/${animations.length} animations downloaded\n`);
  
  // Check for content mismatches
  console.log('=== Content Verification ===');
  results.forEach(r => {
    if (r.content) {
      const animName = (r.content.nm || '').toLowerCase();
      const expectedName = r.name.toLowerCase();
      
      // Check if animation name in JSON matches the expected gift name
      if (!animName.includes(expectedName) && !expectedName.includes(animName.split(' ')[0])) {
        console.warn(`⚠️  MISMATCH: ${r.name}.json contains animation "${r.content.nm}" - may not match gift theme`);
      } else {
        console.log(`✅ ${r.name}.json - animation name: "${r.content.nm}"`);
      }
    }
  });
  
  console.log('\nFiles saved to:', outputDir);
}

downloadAll().catch(console.error);
