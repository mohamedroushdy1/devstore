// lib/utils.js

// وظيفة للتحقق من وجود ملف
function fileExists(filePath) {
    const fs = require('fs');
    return fs.existsSync(filePath);
  }
  
  // وظيفة لحذف ملف
  function deleteFile(filePath) {
    const fs = require('fs');
    if (fileExists(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  
  // وظيفة لقراءة ملف JSON
  function readJsonFile(filePath) {
    const fs = require('fs');
    if (!fileExists(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }
  
  // وظيفة لكتابة ملف JSON
  function writeJsonFile(filePath, data) {
    const fs = require('fs');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
  
  // وظيفة لتحويل حجم الملف إلى صيغة مقروءة
  function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
  
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
  
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
  
  // تصدير الوظائف
  module.exports = {
    fileExists,
    deleteFile,
    readJsonFile,
    writeJsonFile,
    formatFileSize,
  };