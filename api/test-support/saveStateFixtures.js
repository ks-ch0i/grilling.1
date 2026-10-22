export function toLegacyV1Save(state) {
  const legacy = structuredClone(state);
  legacy.schemaVersion = 1;
  delete legacy.gold;
  delete legacy.player.availableStatPoints;
  delete legacy.player.spentStatPoints;
  delete legacy.player.statResetCount;
  return legacy;
}
