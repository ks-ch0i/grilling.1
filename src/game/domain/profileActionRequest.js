export function createProfileActionRequestExecutor({
  applyProfileAction,
  createActionId = () => globalThis.crypto?.randomUUID?.(),
} = {}) {
  let pending = null;

  return async function executeProfileAction(action) {
    if (typeof applyProfileAction !== 'function') {
      return { ok:false, error:'profile-actions-unavailable' };
    }
    const actionKey = JSON.stringify(action);
    if (!pending || pending.actionKey !== actionKey) {
      const actionId = createActionId();
      if (typeof actionId !== 'string' || !actionId) return { ok:false, error:'action-id-unavailable' };
      pending = { actionKey, actionId };
    }
    const result = await applyProfileAction(action, { actionId:pending.actionId });
    if (result?.ok) pending = null;
    return result;
  };
}
