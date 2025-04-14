const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const execPromise = util.promisify(exec);
const BUNDLETOOL_PATH = path.join(__dirname, '../bundletool-all-1.18.1.jar');

// التحقق من وجود ملف bundletool
if (!fs.existsSync(BUNDLETOOL_PATH)) {
  throw new Error(`Bundletool not found at path: ${BUNDLETOOL_PATH}`);
}

// دالة مساعدة للتحقق من مواصفات الجهاز
function validateDeviceSpec(deviceSpec) {
  if (!deviceSpec || typeof deviceSpec !== 'object') {
    throw new Error('مواصفات الجهاز يجب أن تكون كائنًا');
  }

  if (!deviceSpec.sdkVersion || typeof deviceSpec.sdkVersion !== 'string') {
    throw new Error('إصدار SDK مطلوب ويجب أن يكون نصيًا');
  }

  if (!deviceSpec.supportedAbis || !Array.isArray(deviceSpec.supportedAbis)) {
    throw new Error('معماريات الجهاز المطلوبة يجب أن تكون مصفوفة');
  }

  if (deviceSpec.supportedAbis.length === 0) {
    throw new Error('يجب تحديد معمارية واحدة على الأقل');
  }
}

async function convertAabToApks(aabPath, apksPath) {
  // التحقق من وجود ملف الإدخال
  if (!fs.existsSync(aabPath)) {
    throw new Error(`ملف AAB غير موجود: ${aabPath}`);
  }

  const command = `java -jar "${BUNDLETOOL_PATH}" build-apks \
    --bundle="${aabPath}" \
    --output="${apksPath}" \
    --mode=universal \
    --overwrite`;

  try {
    logger.info(`Converting AAB to APKS: ${aabPath}`);
    const { stdout, stderr } = await execPromise(command, {
      maxBuffer: 1024 * 1024 * 50 // 50MB buffer
    });

    if (stderr && stderr.includes('Error')) {
      throw new Error(`Bundletool conversion error: ${stderr}`);
    }

    // التحقق من وجود ملف الإخراج
    if (!fs.existsSync(apksPath)) {
      throw new Error('فشل في إنشاء ملف APKS');
    }

    logger.info(`Successfully created APKS at: ${apksPath}`);
    return { success: true, output: stdout };
  } catch (error) {
    logger.error('AAB to APKS conversion failed', { error: error.message });
    throw new Error(`فشل التحويل: ${error.message}`);
  }
}

async function extractApkForDevice(apksPath, deviceSpec) {
  try {
    // التحقق من صحة المدخلات
    validateDeviceSpec(deviceSpec);

    // التحقق من وجود ملف APKS
    if (!fs.existsSync(apksPath)) {
      throw new Error(`ملف APKS غير موجود: ${apksPath}`);
    }

    const outputDir = path.join('/tmp', `apk_${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const specPath = path.join(outputDir, 'device-spec.json');
    fs.writeFileSync(specPath, JSON.stringify(deviceSpec));

    const command = `java -jar "${BUNDLETOOL_PATH}" extract-apks \
      --apks="${apksPath}" \
      --output-dir="${outputDir}" \
      --device-spec="${specPath}"`;

    logger.info(`Extracting APK for device specs`, { deviceSpec });
    const { stdout, stderr } = await execPromise(command, {
      maxBuffer: 1024 * 1024 * 100 // 100MB buffer
    });

    if (stderr && stderr.includes('Error')) {
      throw new Error(`Extraction error: ${stderr}`);
    }

    const apkPath = findBestMatchingApk(outputDir, deviceSpec);
    if (!apkPath) {
      throw new Error('لم يتم العثور على APK مطابقة');
    }

    // التحقق من صحة ملف APK الناتج
    const stats = fs.statSync(apkPath);
    if (stats.size < 102400) { // 100KB كحد أدنى
      throw new Error('حجم ملف APK الناتج غير صالح');
    }

    logger.info(`Successfully extracted APK at: ${apkPath}`);
    return apkPath;
  } catch (error) {
    logger.error('APK extraction failed', { 
      error: error.message,
      stack: error.stack 
    });
    throw new Error(`فشل استخراج APK: ${error.message}`);
  }
}

function findBestMatchingApk(outputDir, deviceSpec) {
  try {
    const files = fs.readdirSync(outputDir);
    
    // البحث عن تطابق مع ABI
    for (const abi of deviceSpec.supportedAbis) {
      const match = files.find(f => 
        f.toLowerCase().includes(abi.toLowerCase()) && 
        f.endsWith('.apk')
      );
      if (match) {
        return path.join(outputDir, match);
      }
    }
    
    // البحث عن ملف APK عام
    const universalApk = files.find(f => 
      f.toLowerCase().includes('universal') && 
      f.endsWith('.apk')
    );
    
    return universalApk ? path.join(outputDir, universalApk) : null;
  } catch (error) {
    logger.error('Error finding matching APK', { error: error.message });
    return null;
  }
}

module.exports = {
  convertAabToApks,
  extractApkForDevice,
  validateDeviceSpec
};