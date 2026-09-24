/**
 * Create Temporary SVG Frames
 * 
 * ينشئ إطارات SVG مؤقتة كـ data URLs
 * يمكن استخدامها مباشرة بدون رفع على CDN
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════
// SVG Frame Templates
// ═══════════════════════════════════════════════════════════════════════

const frames = {
  goldenHost: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#FFD700;stop-opacity:1" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      <!-- Outer circle glow -->
      <circle cx="100" cy="100" r="95" fill="none" stroke="url(#goldGradient)" 
              stroke-width="8" opacity="0.6" filter="url(#glow)"/>
      
      <!-- Main frame circle -->
      <circle cx="100" cy="100" r="90" fill="none" stroke="url(#goldGradient)" 
              stroke-width="10"/>
      
      <!-- Inner decorative circle -->
      <circle cx="100" cy="100" r="75" fill="none" stroke="url(#goldGradient)" 
              stroke-width="2" opacity="0.5"/>
      
      <!-- Decorative stars -->
      <path d="M100,10 L103,20 L113,20 L105,26 L108,36 L100,30 L92,36 L95,26 L87,20 L97,20 Z" 
            fill="url(#goldGradient)" opacity="0.8"/>
      <path d="M180,100 L177,90 L167,90 L175,84 L172,74 L180,80 L188,74 L185,84 L193,90 L183,90 Z" 
            fill="url(#goldGradient)" opacity="0.6"/>
      <path d="M20,100 L23,90 L33,90 L25,84 L28,74 L20,80 L12,74 L15,84 L7,90 L17,90 Z" 
            fill="url(#goldGradient)" opacity="0.6"/>
      <path d="M100,190 L103,180 L113,180 L105,174 L108,164 L100,170 L92,164 L95,174 L87,180 L97,180 Z" 
            fill="url(#goldGradient)" opacity="0.6"/>
    </svg>
  `,

  vipSilver: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="silverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#C0C0C0;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#E8E8E8;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#C0C0C0;stop-opacity:1" />
        </linearGradient>
        <filter id="silverGlow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      <circle cx="100" cy="100" r="90" fill="none" stroke="url(#silverGradient)" 
              stroke-width="8" filter="url(#silverGlow)"/>
      <circle cx="100" cy="100" r="75" fill="none" stroke="url(#silverGradient)" 
              stroke-width="3" opacity="0.5"/>
      
      <!-- VIP text -->
      <text x="100" y="25" font-family="Arial" font-size="16" font-weight="bold" 
            fill="url(#silverGradient)" text-anchor="middle">VIP</text>
    </svg>
  `,

  vipGold: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#FFD700;stop-opacity:1" />
        </linearGradient>
      </defs>
      
      <circle cx="100" cy="100" r="92" fill="none" stroke="url(#goldGradient2)" 
              stroke-width="6"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="url(#goldGradient2)" 
              stroke-width="4" opacity="0.6"/>
      <circle cx="100" cy="100" r="70" fill="none" stroke="url(#goldGradient2)" 
              stroke-width="2" opacity="0.4"/>
      
      <text x="100" y="25" font-family="Arial" font-size="18" font-weight="bold" 
            fill="url(#goldGradient2)" text-anchor="middle">VIP</text>
    </svg>
  `,

  vipPlatinum: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="platinumGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#E5E4E2;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#FFFFFF;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#E5E4E2;stop-opacity:1" />
        </linearGradient>
      </defs>
      
      <circle cx="100" cy="100" r="92" fill="none" stroke="url(#platinumGradient)" 
              stroke-width="7"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="url(#platinumGradient)" 
              stroke-width="5" opacity="0.7"/>
      <circle cx="100" cy="100" r="68" fill="none" stroke="url(#platinumGradient)" 
              stroke-width="3" opacity="0.5"/>
      
      <text x="100" y="25" font-family="Arial" font-size="18" font-weight="bold" 
            fill="url(#platinumGradient)" text-anchor="middle">VIP</text>
    </svg>
  `,

  svipDiamond: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="diamondGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#9C27B0;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#E91E63;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#9C27B0;stop-opacity:1" />
        </linearGradient>
        <filter id="diamondGlow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      <circle cx="100" cy="100" r="94" fill="none" stroke="url(#diamondGradient)" 
              stroke-width="10" filter="url(#diamondGlow)"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="url(#diamondGradient)" 
              stroke-width="6" opacity="0.7"/>
      <circle cx="100" cy="100" r="66" fill="none" stroke="url(#diamondGradient)" 
              stroke-width="3" opacity="0.5"/>
      
      <!-- Diamond shape -->
      <path d="M100,30 L110,50 L100,70 L90,50 Z" fill="url(#diamondGradient)" opacity="0.8"/>
      
      <text x="100" y="190" font-family="Arial" font-size="16" font-weight="bold" 
            fill="url(#diamondGradient)" text-anchor="middle">SVIP</text>
    </svg>
  `,

  agentBronze: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bronzeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#CD7F32;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#A0522D;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#CD7F32;stop-opacity:1" />
        </linearGradient>
      </defs>
      
      <circle cx="100" cy="100" r="88" fill="none" stroke="url(#bronzeGradient)" 
              stroke-width="7"/>
      <circle cx="100" cy="100" r="75" fill="none" stroke="url(#bronzeGradient)" 
              stroke-width="3" opacity="0.6"/>
      
      <text x="100" y="105" font-family="Arial" font-size="14" font-weight="bold" 
            fill="url(#bronzeGradient)" text-anchor="middle">AGENT</text>
    </svg>
  `,

  agentSilver: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="agentSilverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#C0C0C0;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#E8E8E8;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#C0C0C0;stop-opacity:1" />
        </linearGradient>
      </defs>
      
      <circle cx="100" cy="100" r="90" fill="none" stroke="url(#agentSilverGradient)" 
              stroke-width="8"/>
      <circle cx="100" cy="100" r="76" fill="none" stroke="url(#agentSilverGradient)" 
              stroke-width="4" opacity="0.6"/>
      
      <text x="100" y="105" font-family="Arial" font-size="14" font-weight="bold" 
            fill="url(#agentSilverGradient)" text-anchor="middle">AGENT</text>
    </svg>
  `,

  specialStars: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="starsGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#4CAF50;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#8BC34A;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#4CAF50;stop-opacity:1" />
        </linearGradient>
      </defs>
      
      <circle cx="100" cy="100" r="88" fill="none" stroke="url(#starsGradient)" 
              stroke-width="6"/>
      
      <!-- Stars around -->
      <path d="M100,20 L103,30 L113,30 L105,36 L108,46 L100,40 L92,46 L95,36 L87,30 L97,30 Z" 
            fill="url(#starsGradient)"/>
      <path d="M170,100 L167,90 L157,90 L165,84 L162,74 L170,80 L178,74 L175,84 L183,90 L173,90 Z" 
            fill="url(#starsGradient)"/>
      <path d="M30,100 L33,90 L43,90 L35,84 L38,74 L30,80 L22,74 L25,84 L17,90 L27,90 Z" 
            fill="url(#starsGradient)"/>
      <path d="M100,180 L103,170 L113,170 L105,164 L108,154 L100,160 L92,154 L95,164 L87,170 L97,170 Z" 
            fill="url(#starsGradient)"/>
    </svg>
  `,

  specialFire: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fireGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#FF5722;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#FF9800;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#FFC107;stop-opacity:1" />
        </linearGradient>
        <filter id="fireGlow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      <circle cx="100" cy="100" r="90" fill="none" stroke="url(#fireGradient)" 
              stroke-width="8" filter="url(#fireGlow)"/>
      <circle cx="100" cy="100" r="75" fill="none" stroke="url(#fireGradient)" 
              stroke-width="4" opacity="0.6"/>
      
      <!-- Flame shapes -->
      <path d="M100,30 Q90,50 100,70 Q110,50 100,30" fill="url(#fireGradient)" opacity="0.8"/>
      <path d="M70,100 Q60,110 70,130 Q80,110 70,100" fill="url(#fireGradient)" opacity="0.6"/>
      <path d="M130,100 Q120,110 130,130 Q140,110 130,100" fill="url(#fireGradient)" opacity="0.6"/>
    </svg>
  `,

  specialGalaxy: `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="galaxyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3F51B5;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#9C27B0;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#3F51B5;stop-opacity:1" />
        </linearGradient>
      </defs>
      
      <circle cx="100" cy="100" r="92" fill="none" stroke="url(#galaxyGradient)" 
              stroke-width="9" opacity="0.9"/>
      <circle cx="100" cy="100" r="78" fill="none" stroke="url(#galaxyGradient)" 
              stroke-width="5" opacity="0.6"/>
      <circle cx="100" cy="100" r="64" fill="none" stroke="url(#galaxyGradient)" 
              stroke-width="3" opacity="0.4"/>
      
      <!-- Small stars/dots -->
      <circle cx="80" cy="80" r="2" fill="#FFFFFF" opacity="0.8"/>
      <circle cx="120" cy="70" r="3" fill="#FFFFFF" opacity="0.9"/>
      <circle cx="130" cy="110" r="2" fill="#FFFFFF" opacity="0.7"/>
      <circle cx="70" cy="120" r="3" fill="#FFFFFF" opacity="0.8"/>
      <circle cx="110" cy="130" r="2" fill="#FFFFFF" opacity="0.6"/>
    </svg>
  `,
};

// ═══════════════════════════════════════════════════════════════════════
// Convert SVG to Base64 Data URL
// ═══════════════════════════════════════════════════════════════════════

function svgToDataUrl(svg) {
  const cleaned = svg.trim().replace(/\s+/g, ' ');
  const base64 = Buffer.from(cleaned).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Generate Frame Data URLs
// ═══════════════════════════════════════════════════════════════════════

const frameDataUrls = {};
for (const [name, svg] of Object.entries(frames)) {
  frameDataUrls[name] = svgToDataUrl(svg);
}

// ═══════════════════════════════════════════════════════════════════════
// Save to JSON file
// ═══════════════════════════════════════════════════════════════════════

const outputPath = path.join(__dirname, 'temporary-frames.json');
fs.writeFileSync(outputPath, JSON.stringify(frameDataUrls, null, 2));

console.log('✅ Temporary SVG frames created!');
console.log(`📁 Saved to: ${outputPath}`);
console.log('');
console.log('📋 Available frames:');
Object.keys(frameDataUrls).forEach(name => {
  console.log(`   - ${name}`);
});
console.log('');
console.log('🎨 These frames are ready to use as data URLs');
console.log('💡 Run: node scripts/seed-frames-with-svg.js to add them to database');

module.exports = frameDataUrls;
