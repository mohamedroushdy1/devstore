const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { supabase } = require('../lib/supabase');
const { convertAabToApks } = require('../lib/bundletool');

const router = express.Router();

// تأكد من أن الحزمة مثبتة
try {
  router.use(fileUpload({
    limits: { fileSize: 500 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: '/tmp',
    abortOnLimit: true,
    responseOnLimit: 'File size exceeds the limit'
  }));
} catch (err) {
  console.error('Failed to load express-fileupload:', err);
  process.exit(1);
}

router.post('/', async (req, res, next) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let aabPath, apksPath;
  const sessionId = generateSessionId();
  
  try {
    aabPath = `/tmp/input_${sessionId}.aab`;
    apksPath = `/tmp/output_${sessionId}.apks`;

    await req.files.file.mv(aabPath);
    await convertAabToApks(aabPath, apksPath);

    const filePath = `uploads/${sessionId}/output.apks`;
    const fileStream = fs.createReadStream(apksPath);

    const { error: uploadError } = await supabase.storage
      .from('appfiles')
      .upload(filePath, fileStream, {
        contentType: 'application/octet-stream'
      });

    if (uploadError) throw uploadError;

    const { error: dbError } = await supabase
      .from('sessions')
      .insert([{
        id: sessionId,
        file_url: filePath,
        created_at: new Date().toISOString()
      }]);

    if (dbError) throw dbError;

    res.json({
      success: true,
      sessionId,
      message: 'File processed successfully'
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Processing failed',
      details: error.message
    });
  } finally {
    [aabPath, apksPath].forEach(file => {
      if (file && fs.existsSync(file)) {
        fs.unlink(file, err => err && console.error('Error deleting file:', err));
      }
    });
  }
});

function generateSessionId() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
}

module.exports = router;