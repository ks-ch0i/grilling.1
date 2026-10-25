const OUTCOME_LABELS = Object.freeze({
  win: '승리',
  loss: '패배',
  draw: '무승부',
});

const LOCAL_DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function isCurrentPvpHistoryRequest(requestId, currentRequestId, overlayOpen) {
  return Number.isSafeInteger(requestId) && requestId === currentRequestId && overlayOpen === true;
}

export function formatPvpHistoryRow(item) {
  const completedAt = new Date(item?.completedAtUtc);
  if (!Number.isFinite(completedAt.getTime()) || !Object.hasOwn(OUTCOME_LABELS, item?.outcome) ||
      typeof item?.opponentDisplayName !== 'string' || typeof item?.rated !== 'boolean' ||
      !Number.isSafeInteger(item?.ratingBefore) || !Number.isSafeInteger(item?.ratingAfter)) {
    throw new TypeError('PvP match-history row is invalid.');
  }
  const ratingDelta = item.ratingAfter - item.ratingBefore;
  return {
    completedAt: LOCAL_DATE_TIME_FORMAT.format(completedAt),
    opponent: item.opponentDisplayName,
    outcome: OUTCOME_LABELS[item.outcome],
    rating: item.rated ? `레이팅 ${ratingDelta > 0 ? '+' : ''}${ratingDelta}` : '레이팅 미반영',
  };
}
