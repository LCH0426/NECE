/**
 * MIT License
 *
 * Copyright (c) 2026 LCH0426
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useApiFetch } from '@/composables/use-fetch'

import type { ILeResponse } from '../types/response.type'

export interface ISystemStats {
  cpu: {
    usage: number
    cores: number
    model: string
    perCore: {
      cores: number
      usage: number[]
    }
  }
  memory: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  network: {
    totalUpload: number
    totalDownload: number
    uploadThroughput: number
    downloadThroughput: number
  }
  disk: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  worldSize: number
  uptime: number
  platform: string
  hostname: string
}

export interface ITpsInfo {
  tps: string
  mspt: string
}

export interface IPluginInfo {
  version: string
  serverVersion: string
  protocol: number
}

export interface IPlayerCountData {
  current: number
  todayMax: number
  todayAvg: number
  todayRecords: number
}

export interface IPlayerCountRecord {
  timestamp: number
  count: number
}

export interface IPlayerCountTrend {
  range: string
  startTime: number
  endTime: number
  records: IPlayerCountRecord[]
}

export interface IPlayerCountHistory {
  startTime: number
  endTime: number
  records: IPlayerCountRecord[]
}

export interface IMaintenanceStatus {
  enabled: boolean
  reason: string
  onlinePlayers: number
}

export interface IMaintenanceToggleResult {
  success: boolean
  kickedPlayers?: number
}

export function useSystemApi() {
  const { apiFetch } = useApiFetch()

  function getSystemStats() {
    return apiFetch<ILeResponse<ISystemStats>>('/system/stats', {
      method: 'GET',
    })
  }

  function getTpsInfo() {
    return apiFetch<ILeResponse<ITpsInfo>>('/tps', {
      method: 'GET',
    })
  }

  function getPluginInfo() {
    return apiFetch<ILeResponse<IPluginInfo>>('/version', {
      method: 'GET',
    })
  }

  function getPlayerCount() {
    return apiFetch<ILeResponse<IPlayerCountData>>('/server/playerCount', {
      method: 'GET',
    })
  }

  function getPlayerCountTrend(range?: '1h' | '6h' | '24h' | '7d') {
    return apiFetch<ILeResponse<IPlayerCountTrend>>('/server/playerCount/trend', {
      method: 'GET',
      params: range ? { range } : undefined,
    })
  }

  function getPlayerCountHistory(start: number, end: number) {
    return apiFetch<ILeResponse<IPlayerCountHistory>>('/server/playerCount/history', {
      method: 'GET',
      params: { start, end },
    })
  }

  function getMaintenanceStatus() {
    return apiFetch<ILeResponse<IMaintenanceStatus>>('/maintenance/status', {
      method: 'GET',
    })
  }

  function toggleMaintenance(enable: boolean, reason?: string) {
    return apiFetch<ILeResponse<IMaintenanceToggleResult>>('/maintenance/toggle', {
      method: 'POST',
      body: { enable, reason },
    })
  }

  return {
    getSystemStats,
    getTpsInfo,
    getPluginInfo,
    getPlayerCount,
    getPlayerCountTrend,
    getPlayerCountHistory,
    getMaintenanceStatus,
    toggleMaintenance,
  }
}
