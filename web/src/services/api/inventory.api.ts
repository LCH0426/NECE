import { useApiFetch } from '@/composables/use-fetch'

import type { ILeResponse } from '../types/response.type'

export interface IInventoryItem {
  slot: number
  type: string
  count: number
  name: string
  image?: string
}

export interface IArmorItem {
  slot: string
  type: string
  count: number
  name: string
  image?: string
}

export interface IPlayerInventory {
  xuid: string
  online: boolean
  inventory: IInventoryItem[]
  armor: IArmorItem[]
  offhand: IInventoryItem[]
  saveTime?: string
}

export function useInventoryApi() {
  const { apiFetch } = useApiFetch()

  function getPlayerInventory(xuid: string) {
    return apiFetch<ILeResponse<IPlayerInventory>>(`/players/${xuid}/inventory`, {
      method: 'GET',
    })
  }

  return {
    getPlayerInventory,
  }
}
