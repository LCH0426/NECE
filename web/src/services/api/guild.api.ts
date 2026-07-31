import { useApiFetch } from '@/composables/use-fetch'

import type { ILeResponse } from '../types/response.type'

export interface IGuildItem {
  id: number
  name: string
  description: string
  owner: string
  ownerName: string
  level: number
  fund: number
  maxMembers: number
  memberCount: number
  hqX: number
  hqY: number
  hqZ: number
  hqDim: string
  createdAt: number
}

export interface IGuildMember {
  xuid: string
  guildId: number
  role: string
  joinedAt: number
}

export interface IGuildTeleport {
  id: number
  guildId: number
  name: string
  x: number
  y: number
  z: number
  dim: string
  createdBy: string
  createdAt: number
}

export interface IGuildDetail {
  guild: IGuildItem
  members: IGuildMember[]
  teleports: IGuildTeleport[]
}

export function useGuildApi() {
  const { apiFetch } = useApiFetch()

  function getGuildList() {
    return apiFetch<ILeResponse<IGuildItem[]>>('/admin/guild/list', {
      method: 'GET',
    })
  }

  function getGuildDetail(id: number) {
    return apiFetch<ILeResponse<IGuildDetail>>(`/admin/guild/${id}`, {
      method: 'GET',
    })
  }

  function deleteGuild(id: number) {
    return apiFetch<ILeResponse<null>>(`/admin/guild/${id}`, {
      method: 'DELETE',
    })
  }

  function updateGuild(id: number, data: { name?: string, description?: string, level?: number, maxMembers?: number, fund?: number }) {
    return apiFetch<ILeResponse<null>>(`/admin/guild/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  function getGuildTeleports(id: number) {
    return apiFetch<ILeResponse<IGuildTeleport[]>>(`/admin/guild/${id}/teleports`, {
      method: 'GET',
    })
  }

  function addGuildTeleport(id: number, data: { name: string, x: number, y: number, z: number, dim?: string }) {
    return apiFetch<ILeResponse<null>>(`/admin/guild/${id}/teleports`, {
      method: 'POST',
      body: data,
    })
  }

  function deleteGuildTeleport(id: number, tpId: number) {
    return apiFetch<ILeResponse<null>>(`/admin/guild/${id}/teleports/${tpId}`, {
      method: 'DELETE',
    })
  }

  function updateGuildFund(id: number, fund: number) {
    return apiFetch<ILeResponse<null>>(`/admin/guild/${id}/fund`, {
      method: 'PUT',
      body: { fund },
    })
  }

  return {
    getGuildList,
    getGuildDetail,
    deleteGuild,
    updateGuild,
    getGuildTeleports,
    addGuildTeleport,
    deleteGuildTeleport,
    updateGuildFund,
  }
}
