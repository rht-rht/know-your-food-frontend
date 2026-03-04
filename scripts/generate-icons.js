const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputPath = path.join(__dirname, '../public/icons/icon-512x512.png');
const outputDir = path.join(__dirname, '../public/icons');

async function generateIcons() {
  console.log('Generating icons from:', inputPath);
  
  if (!fs.existsSync(inputPath)) {
    console.error('Source image not found:', inputPath);
    process.exit(1);
  }

  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon-${size}x${size}.png`);
    
    try {
      await sharp(inputPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated: icon-${size}x${size}.png`);
    } catch (err) {
      console.error(`✗ Failed to generate icon-${size}x${size}.png:`, err.message);
    }
  }

  console.log('\nDone! Icons generated in:', outputDir);
}

generateIcons();
