import { useApiFetch } from '@/composables/use-fetch'

import type { ILeResponse } from '../types/response.type'

export interface IBanItem {
  xuid: string
  name: string
  uid: number
  ip: string
  reason: string
  operator: string
  time: string
  banned: boolean
}

export interface IBanCheckData {
  banned: boolean
  reason?: string
  operator?: string
  time?: string
}

export interface IBanResult {
  xuid: string
  name: string
  isBanned: boolean
}

export function useBanApi() {
  const { apiFetch } = useApiFetch()

  function getBanList() {
    return apiFetch<ILeResponse<IBanItem[]>>('/ban/list', {
      method: 'GET',
    })
  }

  function banPlayer(xuid: string, reason?: string) {
    return apiFetch<ILeResponse<IBanResult>>('/ban', {
      method: 'POST',
      body: { xuid, reason },
    })
  }

  function unbanPlayer(xuid: string) {
    return apiFetch<ILeResponse<IBanResult>>('/unban', {
      method: 'POST',
      body: { xuid },
    })
  }

  function checkBanStatus(xuid: string, ip?: string) {
    return apiFetch<ILeResponse<IBanCheckData>>('/ban/check', {
      method: 'GET',
      params: { xuid, ip },
    })
  }

  return { getBanList, banPlayer, unbanPlayer, checkBanStatus }
}
