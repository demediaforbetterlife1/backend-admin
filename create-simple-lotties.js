const fs = require('fs');
const path = require('path');

// Simple heart beating animation
const heartLottie = {
  "v": "5.7.4",
  "fr": 30,
  "ip": 0,
  "op": 60,
  "w": 200,
  "h": 200,
  "nm": "Heart",
  "ddd": 0,
  "assets": [],
  "layers": [{
    "ddd": 0,
    "ind": 1,
    "ty": 4,
    "nm": "Heart",
    "sr": 1,
    "ks": {
      "o": {"a": 0, "k": 100},
      "r": {"a": 0, "k": 0},
      "p": {"a": 0, "k": [100, 100, 0]},
      "a": {"a": 0, "k": [0, 0, 0]},
      "s": {
        "a": 1,
        "k": [
          {"i": {"x": [0.667], "y": [1]}, "o": {"x": [0.333], "y": [0]}, "t": 0, "s": [100]},
          {"i": {"x": [0.667], "y": [1]}, "o": {"x": [0.333], "y": [0]}, "t": 15, "s": [120]},
          {"i": {"x": [0.667], "y": [1]}, "o": {"x": [0.333], "y": [0]}, "t": 30, "s": [100]},
          {"i": {"x": [0.667], "y": [1]}, "o": {"x": [0.333], "y": [0]}, "t": 45, "s": [120]},
          {"t": 60, "s": [100]}
        ]
      }
    },
    "ao": 0,
    "shapes": [{
      "ty": "gr",
      "it": [{
        "ty": "sh",
        "ks": {
          "a": 0,
          "k": {
            "i": [[0, 0], [-5.5, -5.5], [-15, 0], [-9, 9], [0, 15], [9, 9], [15, 0], [5.5, -5.5], [0, 0]],
            "o": [[0, 0], [5.5, 5.5], [15, 0], [9, -9], [0, -15], [-9, -9], [-15, 0], [-5.5, 5.5], [0, 0]],
            "v": [[0, 40], [0, 15], [40, 0], [70, 15], [80, 50], [70, 85], [40, 100], [0, 85], [0, 40]],
            "c": true
          }
        }
      }, {
        "ty": "fl",
        "c": {"a": 0, "k": [0.9, 0.1, 0.3, 1]},
        "o": {"a": 0, "k": 100}
      }, {
        "ty": "tr",
        "p": {"a": 0, "k": [-40, -50]},
        "a": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [100, 100]},
        "r": {"a": 0, "k": 0},
        "o": {"a": 0, "k": 100}
      }]
    }],
    "ip": 0,
    "op": 60,
    "st": 0
  }]
};

// Simple rotating star
const starLottie = {
  "v": "5.7.4",
  "fr": 30,
  "ip": 0,
  "op": 90,
  "w": 200,
  "h": 200,
  "nm": "Star",
  "ddd": 0,
  "assets": [],
  "layers": [{
    "ddd": 0,
    "ind": 1,
    "ty": 4,
    "nm": "Star",
    "sr": 1,
    "ks": {
      "o": {"a": 0, "k": 100},
      "r": {"a": 1, "k": [{"t": 0, "s": [0]}, {"t": 90, "s": [360]}]},
      "p": {"a": 0, "k": [100, 100, 0]},
      "a": {"a": 0, "k": [0, 0, 0]},
      "s": {"a": 0, "k": [100, 100, 100]}
    },
    "ao": 0,
    "shapes": [{
      "ty": "gr",
      "it": [{
        "ty": "sr",
        "sy": 1,
        "pt": {"a": 0, "k": 5},
        "p": {"a": 0, "k": [0, 0]},
        "r": {"a": 0, "k": 0},
        "ir": {"a": 0, "k": 20},
        "or": {"a": 0, "k": 50},
        "os": {"a": 0, "k": 0},
        "is": {"a": 0, "k": 0}
      }, {
        "ty": "fl",
        "c": {"a": 0, "k": [1, 0.843, 0, 1]},
        "o": {"a": 0, "k": 100}
      }, {
        "ty": "tr",
        "p": {"a": 0, "k": [0, 0]},
        "a": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [100, 100]},
        "r": {"a": 0, "k": 0},
        "o": {"a": 0, "k": 100}
      }]
    }],
    "ip": 0,
    "op": 90,
    "st": 0
  }]
};

// Simple rose (flower shape)
const roseLottie = {
  ...heartLottie,
  "nm": "Rose",
  "layers": [{
    ...heartLottie.layers[0],
    "nm": "Rose",
    "shapes": [{
      "ty": "gr",
      "it": [{
        "ty": "el",
        "p": {"a": 0, "k": [0, -20]},
        "s": {"a": 0, "k": [60, 80]}
      }, {
        "ty": "fl",
        "c": {"a": 0, "k": [0.9, 0.2, 0.4, 1]},
        "o": {"a": 0, "k": 100}
      }, {
        "ty": "tr",
        "p": {"a": 0, "k": [0, 0]},
        "a": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [100, 100]},
        "r": {"a": 0, "k": 0},
        "o": {"a": 0, "k": 100}
      }]
    }]
  }]
};

// Diamond with sparkle
const diamondLottie = {
  "v": "5.7.4",
  "fr": 30,
  "ip": 0,
  "op": 60,
  "w": 200,
  "h": 200,
  "nm": "Diamond",
  "ddd": 0,
  "assets": [],
  "layers": [{
    "ddd": 0,
    "ind": 1,
    "ty": 4,
    "nm": "Diamond",
    "sr": 1,
    "ks": {
      "o": {"a": 0, "k": 100},
      "r": {"a": 1, "k": [{"t": 0, "s": [0]}, {"t": 30, "s": [10]}, {"t": 60, "s": [0]}]},
      "p": {"a": 0, "k": [100, 100, 0]},
      "a": {"a": 0, "k": [0, 0, 0]},
      "s": {"a": 0, "k": [100, 100, 100]}
    },
    "ao": 0,
    "shapes": [{
      "ty": "gr",
      "it": [{
        "ty": "sh",
        "ks": {
          "a": 0,
          "k": {
            "i": [[0, 0], [0, 0], [0, 0], [0, 0]],
            "o": [[0, 0], [0, 0], [0, 0], [0, 0]],
            "v": [[0, -50], [40, 0], [0, 50], [-40, 0]],
            "c": true
          }
        }
      }, {
        "ty": "fl",
        "c": {"a": 0, "k": [0.5, 0.8, 1, 1]},
        "o": {"a": 0, "k": 100}
      }, {
        "ty": "tr",
        "p": {"a": 0, "k": [0, 0]},
        "a": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [100, 100]},
        "r": {"a": 0, "k": 0},
        "o": {"a": 0, "k": 100}
      }]
    }],
    "ip": 0,
    "op": 60,
    "st": 0
  }]
};

// Crown
const crownLottie = {
  ...diamondLottie,
  "nm": "Crown",
  "layers": [{
    ...diamondLottie.layers[0],
    "nm": "Crown",
    "shapes": [{
      "ty": "gr",
      "it": [{
        "ty": "rc",
        "d": 1,
        "p": {"a": 0, "k": [0, 10]},
        "s": {"a": 0, "k": [80, 30]},
        "r": {"a": 0, "k": 5}
      }, {
        "ty": "fl",
        "c": {"a": 0, "k": [1, 0.843, 0, 1]},
        "o": {"a": 0, "k": 100}
      }, {
        "ty": "tr",
        "p": {"a": 0, "k": [0, 0]},
        "a": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [100, 100]},
        "r": {"a": 0, "k": 0},
        "o": {"a": 0, "k": 100}
      }]
    }]
  }]
};

// Dragon (simple serpentine shape)
const dragonLottie = {
  ...starLottie,
  "nm": "Dragon",
  "layers": [{
    ...starLottie.layers[0],
    "nm": "Dragon",
    "shapes": [{
      "ty": "gr",
      "it": [{
        "ty": "el",
        "p": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [70, 70]}
      }, {
        "ty": "fl",
        "c": {"a": 0, "k": [0.8, 0.2, 0.2, 1]},
        "o": {"a": 0, "k": 100}
      }, {
        "ty": "tr",
        "p": {"a": 0, "k": [0, 0]},
        "a": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [100, 100]},
        "r": {"a": 0, "k": 0},
        "o": {"a": 0, "k": 100}
      }]
    }]
  }]
};

const animations = [
  { name: 'heart', data: heartLottie },
  { name: 'star', data: starLottie },
  { name: 'rose', data: roseLottie },
  { name: 'diamond', data: diamondLottie },
  { name: 'crown', data: crownLottie },
  { name: 'dragon', data: dragonLottie }
];

const outputDir = path.join(__dirname, 'public', 'animations');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('=== Creating Simple Lottie Animations ===\n');

animations.forEach(anim => {
  const filepath = path.join(outputDir, `${anim.name}.json`);
  fs.writeFileSync(filepath, JSON.stringify(anim.data, null, 2), 'utf8');
  console.log(`✅ Created: ${anim.name}.json`);
});

console.log(`\n✅ All animations created in: ${outputDir}`);
console.log('\nThese are simple, self-hosted Lottie animations that will work without CORS issues.');
console.log('Consider replacing with custom-designed animations later for better quality.');
