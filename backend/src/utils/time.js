export function toMinuteValue(dateLike) {
  return new Date(dateLike).getTime();
}

export function hasOverlap(startA, endA, startB, endB) {
  return toMinuteValue(startA) < toMinuteValue(endB) && toMinuteValue(startB) < toMinuteValue(endA);
}

export function isHalfHourIncrement(dateLike) {
  const date = new Date(dateLike);
  return date.getUTCMinutes() === 0 || date.getUTCMinutes() === 30;
}

export function isFutureRange(startTime, endTime) {
  return new Date(startTime).getTime() < new Date(endTime).getTime();
}
