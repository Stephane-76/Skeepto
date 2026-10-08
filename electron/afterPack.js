const fs = require('fs');
const path = require('path');

// electron-builder does not ship AppStream data. The AppImage catalog
// (appdir-lint) only accepts usr/share/metainfo/*appdata.xml. The unpacked
// app directory is copied to the AppImage root, so a file placed here lands
// on that path. A desktop file next to it lets appstreamcli resolve the
// launchable id.
async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const version = context.packager.appInfo.version;
  const date = new Date().toISOString().slice(0, 10);
  const template = fs.readFileSync(path.join(__dirname, 'skeepto.appdata.xml'), 'utf8');
  const xml = template.split('@VERSION@').join(version).split('@DATE@').join(date);

  const metaDir = path.join(context.appOutDir, 'usr', 'share', 'metainfo');
  await fs.promises.mkdir(metaDir, { recursive: true });
  await fs.promises.writeFile(path.join(metaDir, 'fr.skeema.skeepto.appdata.xml'), xml);

  const appsDir = path.join(context.appOutDir, 'usr', 'share', 'applications');
  await fs.promises.mkdir(appsDir, { recursive: true });
  const desktop = [
    '[Desktop Entry]',
    'Name=Skeepto',
    'Comment=Spreadsheet with a C++ calculation engine',
    'Exec=skeepto %U',
    'Icon=skeepto',
    'Terminal=false',
    'Type=Application',
    'Categories=Office;',
    'StartupWMClass=Skeepto',
    '',
  ].join('\n');
  await fs.promises.writeFile(path.join(appsDir, 'skeepto.desktop'), desktop);
}

module.exports = afterPack;
