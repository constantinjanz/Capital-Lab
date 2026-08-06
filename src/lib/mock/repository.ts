import 'server-only'

import {
  agent,
  costs,
  dashboard,
  eventsView,
  experimentDetails,
  experiments,
  markets,
  memory,
  research,
  settings,
  shell,
} from './data'

export const mockRepository = {
  getShell: () => shell,
  getDashboard: () => dashboard,
  listExperiments: () => experiments,
  getExperiment: (id: string) => experimentDetails[id] ?? null,
  getMarkets: () => markets,
  getEvents: () => eventsView,
  getAgent: () => agent,
  getMemory: () => memory,
  getResearch: () => research,
  getCosts: () => costs,
  getSettings: () => settings,
}
