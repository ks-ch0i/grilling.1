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
