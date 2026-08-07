import {
  REVIEWED_HOSTED_MARKET_MANIFEST_ID,
  type HostedMarketSnapshot,
} from '@/features/markets/hosted-market-snapshot'

export function hasReviewedHostedMarketManifest(
  snapshot: HostedMarketSnapshot,
): boolean {
  return (
    snapshot.universe?.reviewedManifestId === REVIEWED_HOSTED_MARKET_MANIFEST_ID
  )
}
