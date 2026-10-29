export function startSwipe(x, y, width) {
  return {
    x,
    y,
    dx: 0,
    axis: null,
    threshold: Math.min(96, Math.max(64, width * 0.24)),
  };
}
export function moveSwipe(gesture, x, y) {
  const dx = x - gesture.x,
    dy = y - gesture.y;
  let axis = gesture.axis;
  if (!axis) {
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) axis = "x";
    else if (Math.abs(dy) > 10) axis = "y";
  }
  return { ...gesture, axis, dx: axis === "x" ? dx : 0 };
}
export function finishSwipe(gesture) {
  return gesture?.axis === "x" && Math.abs(gesture.dx) >= gesture.threshold
    ? gesture.dx > 0
    : null;
}
