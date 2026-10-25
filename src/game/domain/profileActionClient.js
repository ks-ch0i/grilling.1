import { resetStatPoints } from './progression.js';
import { upgradeGear } from './gear.js';

export function previewProfileSpend(state, intent, { serverProfile = false } = {}) {
  let preview;
  let actionType;
  if (intent?.type === 'reset-stat-points') {
    preview = resetStatPoints(state);
    actionType = 'spend-gold';
  } else if (intent?.type === 'upgrade-gear' && typeof intent.itemId === 'string') {
    if (serverProfile && !Object.values(state.equipment).some((item) => item?.id === intent.itemId)) {
      return { ok: false, reason: 'server-upgrade-requires-equipped-item' };
    }
    preview = upgradeGear(state, intent.itemId);
    actionType = 'spend-materials';
  } else {
    return { ok: false, reason: 'invalid-profile-spend-preview' };
  }
  if (!preview.ok) return preview;
  return {
    ok: true,
    amount: preview.cost,
    action: { type: actionType, amount: preview.cost },
    state: preview.state,
    preview,
  };
}

export function mergeClientOwnedPreview(serverState, previewState) {
  return {
    ...serverState,
    player: {
      ...serverState.player,
      currentHp: previewState.player.currentHp,
      baseStats: { ...previewState.player.baseStats },
      availableStatPoints: previewState.player.availableStatPoints,
      spentStatPoints: previewState.player.spentStatPoints,
      statResetCount: previewState.player.statResetCount,
    },
    equipment: structuredClone(previewState.equipment),
  };
}

export async function runProfileSpendPreview(state, intent, execute, options = {}) {
  const preview = previewProfileSpend(state, intent, options);
  if (!preview.ok) return preview;
  const result = await execute(preview.action);
  if (!result?.ok) return { ...result, preview };
  return {
    ...result,
    amount: preview.amount,
    preview,
    state: mergeClientOwnedPreview(result.state, preview.state),
  };
}

export function installEquippedProfileItem(state, item) {
  if (!item || !Object.hasOwn(state.equipment, item.slot)) return state;
  return {
    ...state,
    equipment: { ...state.equipment, [item.slot]: structuredClone(item) },
  };
}
