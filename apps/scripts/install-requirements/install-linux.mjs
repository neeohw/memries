import { goTarballUrl, nodeTarballUrl } from './versions.mjs';

export async function installLinux(deps) {
  const prefix = deps.prefix();
  if (!deps.nodeOk()) {
    deps.log(`Installing Node ${deps.nodeDistVersion} into ${prefix}…`);
    await deps.installTarball({
      url: nodeTarballUrl(deps.arch(), deps.platform()),
      dest: prefix,
      strip: 1,
    });
  } else {
    deps.log(`Node ${deps.nodeVersion()} already satisfies >=20`);
  }
  if (!deps.goFound()) {
    deps.log(`Installing Go ${deps.goDistVersion} into ${prefix}…`);
    await deps.installTarball({
      url: goTarballUrl(deps.arch(), deps.platform()),
      dest: prefix,
      strip: 0,
    });
  } else {
    deps.log(`Go already installed (${deps.goVersion()}); skipping install and update`);
  }
}
