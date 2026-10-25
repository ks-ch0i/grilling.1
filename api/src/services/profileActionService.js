import { randomInt } from 'node:crypto';
import * as cloudSaveRepository from '../repositories/cloudSaveRepository.js';
import * as actionRepository from '../repositories/profileActionRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
import { parseCloudSave } from '../domain/cloudSave.js';
import { ProfileActionValidationError, validateProfileAction } from '../domain/profileAction.js';
import { mergeRewardProfile, parseRewardProfile } from '../domain/playerProfile.js';

const MATERIAL_YIELD = Object.freeze({ common: 1, uncommon: 2, rare: 4, unique: 8, legendary: 16 });

function isDuplicateKey(error) {
  return error?.number === 2601 || error?.number === 2627 ||
    error?.originalError?.info?.number === 2601 || error?.originalError?.info?.number === 2627;
}

function dependenciesWithDefaults(dependencies = {}) {
  return {
    repository: dependencies.repository ?? { ...cloudSaveRepository, ...actionRepository },
    withTransaction: dependencies.withTransaction ?? defaultWithTransaction,
    clock: dependencies.clock ?? (() => new Date()),
    rollCritical: dependencies.rollCritical ?? (() => randomInt(20) === 0),
  };
}

function conflictForActionId() {
  return { status: 409, code: 'action-id-conflict' };
}

function decodeReceipt(value) {
  const receipt = typeof value === 'string' ? JSON.parse(value) : value;
  if (!receipt || !Number.isSafeInteger(Number(receipt.appliedRevision))) {
    throw new TypeError('Stored profile action receipt is invalid.');
  }
  return {
    appliedRevision: Number(receipt.appliedRevision),
    ...(receipt.consumedItem ? { consumedItem: receipt.consumedItem } : {}),
    ...(receipt.materialsGained !== undefined ? { materialsGained: Number(receipt.materialsGained) } : {}),
    ...(receipt.criticalSuccess !== undefined ? { criticalSuccess: Boolean(receipt.criticalSuccess) } : {}),
  };
}

async function currentForUpdate(transaction, playerId, repository) {
  const saveRow = await repository.getSaveForUpdate(transaction, playerId);
  if (!saveRow) return null;
  const profileRow = await repository.getRewardProfileByPlayerId(transaction, playerId, { lock: true });
  if (!profileRow) return null;
  const profile = parseRewardProfile(profileRow);
  return { saveRow, profile, envelope: parseCloudSave(saveRow, profile) };
}

function replayResponse(receiptRow, current) {
  const receipt = decodeReceipt(receiptRow.ResultJson);
  return {
    status: 200,
    revision: current.envelope.revision,
    ...receipt,
    state: current.envelope.state,
    replayed: true,
  };
}

function applyAction(profile, action, rollCritical, state) {
  const next = {
    ...profile,
    inventory: [...profile.inventory],
    clearedStageIds: [...profile.clearedStageIds],
  };
  if (action.type === 'equip-inventory-item') {
    const index = next.inventory.findIndex((item) => item.id === action.itemId);
    if (index < 0) return { status: 404, code: 'inventory-item-not-found' };
    const item = next.inventory[index];
    const equipped = state.equipment?.[item.slot] ?? null;
    if (Object.hasOwn(action, 'expectedEquippedItemId') &&
        (equipped?.id ?? null) !== action.expectedEquippedItemId) {
      return { status: 409, code: 'equipment-changed' };
    }
    const [consumedItem] = next.inventory.splice(index, 1);
    if (equipped && Object.hasOwn(action, 'expectedEquippedItemId')) next.inventory.push(equipped);
    return {
      status: 200,
      profile: next,
      receipt: { consumedItem },
    };
  }
  if (action.type === 'dismantle-inventory-item') {
    const index = next.inventory.findIndex((item) => item.id === action.itemId);
    if (index < 0) return { status: 404, code: 'inventory-item-not-found' };
    const [item] = next.inventory.splice(index, 1);
    const baseYield = MATERIAL_YIELD[item.rarity];
    if (!baseYield) throw new TypeError('Inventory contains an unsupported item rarity.');
    const criticalSuccess = Boolean(rollCritical());
    const materialsGained = baseYield * (criticalSuccess ? 2 : 1);
    const materials = next.materials + materialsGained;
    if (!Number.isSafeInteger(materials)) return { status: 422, code: 'profile-overflow' };
    next.materials = materials;
    return { status: 200, profile: next, receipt: { materialsGained, criticalSuccess } };
  }
  const field = action.type === 'spend-gold' ? 'gold' : 'materials';
  if (next[field] < action.amount) {
    return { status: 422, code: field === 'gold' ? 'insufficient-gold' : 'insufficient-materials' };
  }
  next[field] -= action.amount;
  return { status: 200, profile: next, receipt: {} };
}

async function existingActionResponse(transaction, playerId, actionId, requestJson, repository) {
  const receipt = await repository.getProfileAction(transaction, playerId, actionId, { lock: true });
  if (!receipt) return null;
  if (receipt.RequestJson !== requestJson) return conflictForActionId();
  const current = await currentForUpdate(transaction, playerId, repository);
  if (!current) return { status: 404, code: 'profile-not-found' };
  return replayResponse(receipt, current);
}

export async function applyProfileAction(pool, identity, body, dependencies) {
  const deps = dependenciesWithDefaults(dependencies);
  let request;
  try {
    request = validateProfileAction(body);
  } catch (error) {
    if (error instanceof ProfileActionValidationError) return { status: 400, code: error.code };
    throw error;
  }
  const nowUtc = deps.clock();
  if (!(nowUtc instanceof Date) || !Number.isFinite(nowUtc.getTime())) {
    throw new TypeError('Profile action clock returned an invalid timestamp.');
  }
  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'profile-not-found' };
  const requestJson = JSON.stringify(request);

  try {
    return await deps.withTransaction(pool, async (transaction) => {
      const alreadyApplied = await deps.repository.getProfileAction(transaction, playerId, request.actionId);
      if (alreadyApplied && alreadyApplied.RequestJson !== requestJson) return conflictForActionId();
      if (!await deps.repository.lockPlayer(transaction, playerId)) return { status: 404, code: 'profile-not-found' };
      const confirmed = await existingActionResponse(
        transaction, playerId, request.actionId, requestJson, deps.repository,
      );
      if (confirmed) return confirmed;

      const current = await currentForUpdate(transaction, playerId, deps.repository);
      if (!current) return { status: 404, code: 'profile-not-found' };
      if (current.envelope.revision !== request.expectedSaveRevision) {
        return {
          status: 409,
          code: 'save-revision-conflict',
          revision: current.envelope.revision,
          state: current.envelope.state,
        };
      }

      const applied = applyAction(current.profile, request.action, deps.rollCritical, current.envelope.state);
      if (applied.status !== 200) {
        return applied.status === 409
          ? { ...applied, revision:current.envelope.revision, state:current.envelope.state }
          : applied;
      }
      let sourceState = current.envelope.state;
      if (request.action.type === 'equip-inventory-item' &&
          Object.hasOwn(request.action, 'expectedEquippedItemId')) {
        const equippedItem = applied.receipt.consumedItem;
        sourceState = {
          ...sourceState,
          inventory:applied.profile.inventory,
          equipment:{
            ...sourceState.equipment,
            [equippedItem.slot]:structuredClone(equippedItem),
          },
        };
      }
      const state = mergeRewardProfile(sourceState, applied.profile);
      const updatedSave = await deps.repository.compareAndSwap(transaction, {
        playerId,
        schemaVersion: 2,
        saveJson: JSON.stringify(state),
        updatedAtUtc: nowUtc,
        expectedRevision: request.expectedSaveRevision,
        rewardProfile: applied.profile,
      });
      if (!updatedSave) {
        const latest = await currentForUpdate(transaction, playerId, deps.repository);
        return latest
          ? { status: 409, code: 'save-revision-conflict', revision: latest.envelope.revision, state: latest.envelope.state }
          : { status: 404, code: 'profile-not-found' };
      }
      const appliedRevision = Number(updatedSave.Revision);
      if (!Number.isSafeInteger(appliedRevision)) throw new TypeError('Updated save revision is invalid.');
      const receipt = { appliedRevision, ...applied.receipt };
      const ledgerRow = await deps.repository.insertProfileAction(transaction, {
        playerId,
        actionId: request.actionId,
        requestJson,
        resultJson: JSON.stringify(receipt),
        appliedAtUtc: nowUtc,
      });
      if (!ledgerRow) throw new Error('Profile action ledger insert returned no row.');
      return {
        status: 200,
        revision: appliedRevision,
        ...receipt,
        state,
        replayed: false,
      };
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const replay = await deps.withTransaction(pool, async (transaction) => {
      if (!await deps.repository.lockPlayer(transaction, playerId)) return null;
      return existingActionResponse(transaction, playerId, request.actionId, requestJson, deps.repository);
    });
    return replay ?? conflictForActionId();
  }
}

export function createProfileActionService(dependencies = {}) {
  return { applyProfileAction: (pool, identity, body) => applyProfileAction(pool, identity, body, dependencies) };
}
