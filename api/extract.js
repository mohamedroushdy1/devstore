const express = require('express');
const { supabase } = require('../lib/supabase');
const { extractApkForDevice } = require('../lib/bundletool');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../lib/logger');

const router = express.Router();

// Middleware للتحقق من صحة البيانات
const validateRequest = (req, res, next) => {
  const { sessionId, deviceSpec } = req.body;
  
  if (!sessionId || !deviceSpec) {
    logger.error('Missing parameters', { sessionId, deviceSpec });
    return res.status(400).json({
      success: false,
      error: 'missing_parameters',
      message: 'يجب تقديم معرف الجلسة ومواصفات الجهاز',
      details: {
        required: ['sessionId', 'deviceSpec'],
        received: Object.keys(req.body)
      }
    });
  }

  if (!deviceSpec.sdkVersion || !deviceSpec.supportedAbis) {
    logger.error('Invalid device specs', { deviceSpec });
    return res.status(400).json({
      success: false,
      error: 'invalid_device_specs',
      message: 'مواصفات الجهاز غير مكتملة',
      requiredSpecs: ['sdkVersion', 'supportedAbis']
    });
  }

  next();
};

// Extract APK endpoint
router.post('/', validateRequest, async (req, res) => {
  const { sessionId, deviceSpec } = req.body;
  let tempPath, apkPath;
  
  try {
    logger.info(`Processing request for session: ${sessionId}`);

    // 1. جلب بيانات الجلسة مع التحقق المكثف
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('file_url, created_at')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      logger.error('Session not found', { sessionId, error: sessionError });
      return res.status(404).json({
        success: false,
        error: 'session_not_found',
        message: 'لم يتم العثور على الجلسة',
        solution: 'يرجى رفع الملف مرة أخرى'
      });
    }

    // 2. التحقق من وجود الملف في التخزين قبل التنزيل
    const { data: fileList } = await supabase.storage
      .from('appfiles')
      .list(path.dirname(session.file_url));

    const fileName = path.basename(session.file_url);
    const fileExists = fileList?.some(file => file.name === fileName);

    if (!fileExists) {
      logger.error('File not found in storage', { filePath: session.file_url });
      return res.status(404).json({
        success: false,
        error: 'file_not_found',
        message: 'الملف غير موجود في التخزين',
        details: `المسار: ${session.file_url}`
      });
    }

    // 3. تنزيل الملف مع التحكم بالوقت
    const downloadPromise = supabase.storage
      .from('appfiles')
      .download(session.file_url);

    // إضافة timeout للتنزيل (30 ثانية)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('انتهى وقت تنزيل الملف')), 30000));

    const { data: fileData, error: downloadError } = 
      await Promise.race([downloadPromise, timeoutPromise]);

    if (downloadError) {
      logger.error('Download failed', {
        sessionId,
        filePath: session.file_url,
        error: downloadError
      });
      throw {
        status: 500,
        code: 'download_failed',
        message: 'فشل في تنزيل الملف من التخزين',
        storageError: downloadError.message
      };
    }

    // 4. حفظ الملف مؤقتًا
    tempPath = path.join('/tmp', `temp_${uuidv4()}.apks`);
    await fs.promises.writeFile(tempPath, Buffer.from(await fileData.arrayBuffer()));

    // 5. استخراج APK مع التحقق من النتيجة
    apkPath = await extractApkForDevice(tempPath, deviceSpec);
    if (!apkPath || !fs.existsSync(apkPath)) {
      logger.error('APK extraction failed', { apkPath });
      throw {
        status: 500,
        code: 'extraction_failed',
        message: 'فشل في استخراج ملف التثبيت',
        details: 'قد يكون الملف غير صالح'
      };
    }

    // 6. رفع APK المستخرجة
    const apkFileName = `downloads/${sessionId}/${path.basename(apkPath)}`;
    logger.info(`Uploading extracted APK: ${apkFileName}`);

    const { error: uploadError } = await supabase.storage
      .from('appfiles')
      .upload(apkFileName, fs.createReadStream(apkPath), {
        contentType: 'application/vnd.android.package-archive',
        upsert: true,
        cacheControl: '3600' // تخزين مؤقت لمدة ساعة
      });

    if (uploadError) {
      logger.error('Upload failed', { apkFileName, error: uploadError });
      throw {
        status: 500,
        code: 'upload_failed',
        message: 'فشل في رفع الملف المستخرج',
        details: uploadError.message
      };
    }

    // 7. إرجاع رابط التنزيل
    const downloadUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/appfiles/${apkFileName}`;
    
    logger.info(`Successfully processed request for session: ${sessionId}`, {
      downloadUrl,
      fileSize: fs.statSync(apkPath).size
    });

    res.json({
      success: true,
      downloadUrl,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      fileSize: fs.statSync(apkPath).size
    });

  } catch (error) {
    logger.error('Error in APK extraction', {
      sessionId,
      error: error.message || error,
      stack: error.stack,
      ...(error.details && { details: error.details })
    });

    const status = error.status || 500;
    res.status(status).json({
      success: false,
      error: error.code || 'internal_error',
      message: error.message || 'حدث خطأ غير متوقع',
      ...(error.details && { details: error.details }),
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  } finally {
    // 8. تنظيف الملفات المؤقتة بشكل متوازي
    const cleanUpFiles = [tempPath, apkPath]
      .filter(Boolean)
      .map(filePath => 
        fs.promises.unlink(filePath)
          .catch(err => logger.warn('Failed to delete temp file', { filePath, error: err }))
      );

    await Promise.all(cleanUpFiles);
  }
});

module.exports = router;