type StoredWeatherSnapshot = {
  snapshotId: string;
  issuedAt: string;
  validUntil: string;
  generatedAt: string;
  forecasts: unknown[];
  staleObservedAt: string | null;
  staleReason: string | null;
  failureKind: string | null;
};

export function publicWeatherSnapshot(snapshot: StoredWeatherSnapshot) {
  const { snapshotId: _snapshotId, staleObservedAt, staleReason, failureKind, ...weather } = snapshot;
  if (staleObservedAt === null) return weather;
  return { ...weather, staleObservedAt, staleReason, failureKind };
}
