export const queueMetricText = (value: number | null | undefined): string => value == null ? "Unknown" : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
