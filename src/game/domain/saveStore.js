import { GEAR_SLOT, BALANCE } from '../data/balance.js';
export const SAVE_KEY='lancer-belt-scroll-game:save:v1';
const REQUIRED_EQUIPMENT_SLOTS=Object.values(GEAR_SLOT);
function cloneState(state) {
 if(typeof globalThis.structuredClone==='function') return globalThis.structuredClone(state);
 return JSON.parse(JSON.stringify(state));
}
function isValidState(state) {
 return state!==null && typeof state==='object' && state.schemaVersion===1 &&
  Array.isArray(state.inventory) && state.inventory.length<=BALANCE.inventoryCapacity &&
  Number.isFinite(state.materials) && state.materials>=0 &&
  state.equipment!==null && typeof state.equipment==='object' &&
  REQUIRED_EQUIPMENT_SLOTS.every(slot=>Object.prototype.hasOwnProperty.call(state.equipment,slot));
}
export function loadGameState(fallbackState,storage=globalThis.localStorage) {
 try {
  const serialized=storage.getItem(SAVE_KEY);
  if(serialized===null) return cloneState(fallbackState);
  const state=JSON.parse(serialized);
  return isValidState(state)?state:cloneState(fallbackState);
 } catch { return cloneState(fallbackState); }
}
export function saveGameState(state,storage=globalThis.localStorage) {
 try {
  if(!isValidState(state)) return {ok:false,error:'invalid-state'};
  const serialized=JSON.stringify(state);
  if(serialized===undefined) return {ok:false,error:'invalid-state'};
  storage.setItem(SAVE_KEY,serialized);
  return {ok:true};
 } catch { return {ok:false,error:'storage-unavailable'}; }
}
export function removeSavedGame(storage=globalThis.localStorage) {
 try { storage.removeItem(SAVE_KEY); return {ok:true}; }
 catch { return {ok:false,error:'storage-unavailable'}; }
}
