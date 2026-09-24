/**
 * Upload Service
 * 
 * Handles file uploads using Cloudinary or memory storage
 */

const multer = require('multer');

// Optional: Cloudinary support (only if cloudinary package is installed)
let cloudinary;
try {
  cloudinary = require('cloudinary').v2;
  
  // Configure Cloudinary if env vars are present
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }
} catch (err) {
  console.log('[uploadService] Cloudinary not installed - using memory storage only');
  cloudinary = null;
}

// Check if Cloudinary is configured
const isCloudinaryConfigured = () => {
  return cloudinary && Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
};

// ══════════════════════════════════════════════════════════════
// MEMORY STORAGE (always available)
// ══════════════════════════════════════════════════════════════

const memoryStorage = multer.memoryStorage();

// ══════════════════════════════════════════════════════════════
// MULTER UPLOAD INSTANCE (using memory storage always)
// ══════════════════════════════════════════════════════════════

const uploadService = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept images and documents
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDF, and Word documents are allowed.'));
    }
  },
});

// ══════════════════════════════════════════════════════════════
// HELPER: Upload to Cloudinary directly (for memory storage)
// ══════════════════════════════════════════════════════════════

async function uploadToCloudinary(buffer, folder = 'agency_documents', resourceType = 'auto') {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        quality: 'auto',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

// ══════════════════════════════════════════════════════════════
// MIDDLEWARE: Process uploaded file and add URL
// ══════════════════════════════════════════════════════════════

function processUpload(req, res, next) {
  if (!req.file) return next();

  // If using Cloudinary storage, URL is already available
  if (req.file.path) {
    req.file.url = req.file.path;
    return next();
  }

  // If using memory storage, upload to Cloudinary manually
  if (req.file.buffer && isCloudinaryConfigured()) {
    uploadToCloudinary(req.file.buffer)
      .then((result) => {
        req.file.url = result.secure_url;
        req.file.cloudinary_id = result.public_id;
        next();
      })
      .catch((err) => {
        console.error('[uploadService] Cloudinary upload failed:', err);
        // Return a placeholder URL for development
        req.file.url = `/uploads/placeholder_${Date.now()}_${req.file.originalname}`;
        next();
      });
  } else {
    // No cloud storage available - return placeholder
    req.file.url = `/uploads/placeholder_${Date.now()}_${req.file.originalname}`;
    next();
  }
}

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════

module.exports = {
  uploadService,
  processUpload,
  uploadToCloudinary,
  isCloudinaryConfigured,
};
