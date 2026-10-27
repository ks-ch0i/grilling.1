export const BATTLE_BACKGROUND_THEMES = Object.freeze([
  'forest-trail',
  'ruined-village',
  'rocky-canyon',
  'snowy-fortress',
  'volcanic-citadel',
]);

const battleLayers = (theme) => Object.freeze({
  far: Object.freeze({
    key: `background-${theme}-far`,
    path: `/assets/backgrounds/battle/${theme}-far.png`,
  }),
  mid: Object.freeze({
    key: `background-${theme}-mid`,
    path: `/assets/backgrounds/battle/${theme}-mid.png`,
  }),
  front: Object.freeze({
    key: `background-${theme}-front`,
    path: `/assets/backgrounds/battle/${theme}-front.png`,
  }),
});

const staticScene = (file) => Object.freeze({
  key: `background-${file}`,
  path: `/assets/backgrounds/${file}.png`,
});

export const BACKGROUND_ASSETS = Object.freeze({
  battle: Object.freeze(Object.fromEntries(
    BATTLE_BACKGROUND_THEMES.map((theme) => [theme, battleLayers(theme)]),
  )),
  town: staticScene('town-frontier-square'),
  pvp: staticScene('pvp-stone-arena'),
});

export function getBattleBackgroundAssetKeys(theme) {
  const assets = BACKGROUND_ASSETS.battle[theme];
  if (!assets) throw new RangeError(`Unsupported battle background theme: ${theme}`);
  return Object.freeze({
    far: assets.far.key,
    mid: assets.mid.key,
    front: assets.front.key,
  });
}

export function preloadSceneBackgroundAssets(load) {
  if (typeof load?.image !== 'function') throw new TypeError('Background asset loader must provide image().');
  for (const theme of BATTLE_BACKGROUND_THEMES) {
    for (const asset of Object.values(BACKGROUND_ASSETS.battle[theme])) {
      load.image(asset.key, asset.path);
    }
  }
  load.image(BACKGROUND_ASSETS.town.key, BACKGROUND_ASSETS.town.path);
  load.image(BACKGROUND_ASSETS.pvp.key, BACKGROUND_ASSETS.pvp.path);
}
