function assertItemCount(itemCount) {
  if (!Number.isSafeInteger(itemCount) || itemCount < 0) {
    throw new RangeError('itemCount must be a non-negative safe integer');
  }
}

function assertLayout(columns, visibleRows) {
  if (!Number.isSafeInteger(columns) || columns < 1) {
    throw new RangeError('columns must be a positive safe integer');
  }
  if (!Number.isSafeInteger(visibleRows) || visibleRows < 1) {
    throw new RangeError('visibleRows must be a positive safe integer');
  }
}

export function getMaxInventoryScrollRow(itemCount, columns = 2, visibleRows = 5) {
  assertItemCount(itemCount);
  assertLayout(columns, visibleRows);
  return Math.max(0, Math.ceil(itemCount / columns) - visibleRows);
}

export function clampInventoryScrollRow(row, itemCount, columns = 2, visibleRows = 5) {
  if (!Number.isSafeInteger(row)) {
    throw new RangeError('row must be a safe integer');
  }
  const maxRow = getMaxInventoryScrollRow(itemCount, columns, visibleRows);
  return Math.max(0, Math.min(maxRow, row));
}

export function getDragScrollRow(
  startRow,
  startY,
  currentY,
  itemCount,
  rowHeight = 78,
  columns = 2,
  visibleRows = 5,
) {
  if (!Number.isSafeInteger(startRow)) {
    throw new RangeError('startRow must be a safe integer');
  }
  if (!Number.isFinite(startY) || !Number.isFinite(currentY)) {
    throw new RangeError('drag coordinates must be finite numbers');
  }
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    throw new RangeError('rowHeight must be a positive finite number');
  }
  return clampInventoryScrollRow(
    startRow + Math.round((startY - currentY) / rowHeight),
    itemCount,
    columns,
    visibleRows,
  );
}

export function hasInventoryDragExceededThreshold(startY, currentY, threshold = 8) {
  if (!Number.isFinite(startY) || !Number.isFinite(currentY)) {
    throw new RangeError('drag coordinates must be finite numbers');
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError('threshold must be a non-negative finite number');
  }
  return Math.abs(currentY - startY) > threshold;
}

export function canSelectInventoryItem(drag, pointerId) {
  return Boolean(drag && drag.pointerId === pointerId && !drag.moved);
}

export function getInventoryTapItemId(drag, tap, pointer, inventory) {
  if (!pointer || !Array.isArray(inventory)) return null;
  if (!canSelectInventoryItem(drag, pointer?.id) || tap?.pointerId !== pointer?.id) return null;
  if (
    pointer.x < tap.left || pointer.x > tap.right
    || pointer.y < tap.top || pointer.y > tap.bottom
  ) return null;
  return inventory.some((item) => item.id === tap.itemId) ? tap.itemId : null;
}

export function removeInventoryInputHandlers(input, handlers) {
  if (!handlers) return;
  for (const [event, handler] of Object.entries(handlers)) {
    input.off(event, handler);
  }
}
