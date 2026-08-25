import { useApiFetch } from '@/composables/use-fetch'

import type { ILeResponse } from '../types/response.type'

export interface IPlayTimeDay {
  date: string
  seconds: number
  level: number
}

export interface IPlayTimeHeatmap {
  xuid: string
  playerName: string
  totalPlayTime: number
  activeDays: number
  registerTime?: string
  leavetime?: string
  days: IPlayTimeDay[]
}

export interface IPlayTimeHeatmapParams {
  name?: string
  xuid?: string
}

export interface IRandomAssignParams {
  xuid: string
  endType: 'last' | 'now' | 'custom'
  endDate?: string
}

export interface IUnassignedPlayer {
  xuid: string
  name: string
  uid: number | string
  registerTime: string
  leavetime: string
  playTime: number
}

export interface IBatchRandomAssignResult {
  xuid: string
  name: string
  success: boolean
  assigned?: number
  totalSeconds?: number
  error?: string
}

export function usePlaytimeApi() {
  const { apiFetch } = useApiFetch()

  function getPlayTimeHeatmap(params?: IPlayTimeHeatmapParams) {
    const query = new URLSearchParams()
    if (params?.name)
      query.set('name', params.name)
    if (params?.xuid)
      query.set('xuid', params.xuid)
    const qs = query.toString()
    return apiFetch<ILeResponse<IPlayTimeHeatmap>>(`/playtime/heatmap${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    })
  }

  function postRandomAssign(body: IRandomAssignParams) {
    return apiFetch<ILeResponse<{ assigned: number, totalSeconds: number }>>('/playtime/random-assign', {
      method: 'POST',
      body,
    })
  }

  function getUnassignedPlayers() {
    return apiFetch<ILeResponse<{ total: number, players: IUnassignedPlayer[] }>>('/playtime/unassigned', {
      method: 'GET',
    })
  }

  function postBatchRandomAssign(body: { xuids: string[], endType: 'last' | 'now' }) {
    return apiFetch<ILeResponse<{ total: number, successCount: number, failCount: number, results: IBatchRandomAssignResult[] }>>('/playtime/batch-random-assign', {
      method: 'POST',
      body,
    })
  }

  return { getPlayTimeHeatmap, postRandomAssign, getUnassignedPlayers, postBatchRandomAssign }
}
