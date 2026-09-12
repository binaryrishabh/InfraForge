/* Pure fit-view math for the designer canvas.
Frames every node box (top-left anchor + card dimensions) inside the
container with padding, clamped to a scale range, then centered.
Returns null when there is nothing to frame or no space to frame it in. */

export interface FitNodeBox {
  x: number;
  y: number;
}

export interface FitViewportOptions {
  padding: number;
  minScale: number;
  maxScale: number;
}

export interface FitViewportResult {
  scale: number;
  translateX: number;
  translateY: number;
}

export function computeFitViewport(
  nodes: FitNodeBox[],
  containerWidth: number,
  containerHeight: number,
  nodeWidth: number,
  nodeHeight: number,
  options: FitViewportOptions,
): FitViewportResult | null {
  if (nodes.length === 0) return null;
  if (containerWidth <= 0 || containerHeight <= 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    if (node.x < minX) minX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.x + nodeWidth > maxX) maxX = node.x + nodeWidth;
    if (node.y + nodeHeight > maxY) maxY = node.y + nodeHeight;
  }

  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;

  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const availableWidth = containerWidth - options.padding * 2;
  const availableHeight = containerHeight - options.padding * 2;

  if (availableWidth <= 0 || availableHeight <= 0) return null;

  const naturalScale = Math.min(
    availableWidth / boxWidth,
    availableHeight / boxHeight,
  );

  const scale = Math.min(
    options.maxScale,
    Math.max(options.minScale, naturalScale),
  );

  const translateX = (containerWidth - boxWidth * scale) / 2 - minX * scale;
  const translateY = (containerHeight - boxHeight * scale) / 2 - minY * scale;

  return { scale, translateX, translateY };
}