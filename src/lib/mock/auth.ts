import 'server-only'

export interface MockOwner {
  id: 'mock-owner'
  email: 'owner@capital-lab.local'
  displayName: 'Research Owner'
  authorizationSource: 'deterministic-mock-boundary'
}

/**
 * Mock mode intentionally has no remote identity provider. Keeping this boundary
 * server-only gives protected layouts one replacement point when Supabase auth is enabled.
 */
export function requireMockOwner(): MockOwner {
  return {
    id: 'mock-owner',
    email: 'owner@capital-lab.local',
    displayName: 'Research Owner',
    authorizationSource: 'deterministic-mock-boundary',
  }
}
