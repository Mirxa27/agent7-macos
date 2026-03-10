const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`🔐 Notarizing ${appName}...`);
  console.log(`📁 App path: ${appPath}`);

  // Get credentials from environment variables
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID || '48P296BWWP';

  if (!appleId || !appleIdPassword) {
    console.warn('⚠️  Skipping notarization: APPLE_ID and/or APPLE_APP_SPECIFIC_PASSWORD environment variables not set');
    return;
  }

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId: 'com.mirxa.agent7',
      appPath: appPath,
      appleId: appleId,
      appleIdPassword: appleIdPassword,
      teamId: teamId
    });
    
    console.log(`✅ Notarization complete for ${appName}`);
  } catch (error) {
    console.error(`❌ Notarization failed:`, error);
    throw error;
  }
};
