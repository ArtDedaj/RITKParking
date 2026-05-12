export function toMs(dateLike) {
  return new Date(dateLike).getTime();
}

export function hasOverlap(startA, endA, startB, endB) {
  return toMs(startA) < toMs(endB) && toMs(startB) < toMs(endA);
}

export function isHalfHourIncrement(dateLike) {
  const date = new Date(dateLike);
  return date.getUTCMinutes() === 0 || date.getUTCMinutes() === 30;
}

export function isFutureRange(startTime, endTime) {
  return toMs(startTime) < toMs(endTime);
}
