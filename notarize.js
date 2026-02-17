const { notarize } = require('electron-notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`Notarizing ${appName}...`);
  console.log(`App path: ${path.join(appOutDir, `${appName}.app`)}`);

  try {
    await notarize({
      appBundleId: 'com.mirxa.agent7',
      appPath: path.join(appOutDir, `${appName}.app`),
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
      tool: 'notarytool'
    });
    
    console.log(`✅ Notarization complete for ${appName}`);
  } catch (error) {
    console.error(`❌ Notarization failed:`, error);
    throw error;
  }
};