import { useApiFetch } from '@/composables/use-fetch'

import type { ILeResponse } from '../types/response.type'

export interface IMapArtItem {
  id: number
  filename: string
  original_name: string
  file_size: number
  upload_time: string
  uid?: string
  uploader?: string
}

export interface IMapArtAdminListParams {
  page?: number
  pageSize?: number
  uid?: string
}

export interface IMapArtAdminListData {
  items: IMapArtItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface IMapArtQuota {
  used: number
  limit: number
  usedMB: string
  limitMB: string
}

export interface IMapArtUploadData {
  id: number
  filename: string
  size: number
}

export function useMapArtApi() {
  const { apiFetch } = useApiFetch()

  function uploadMapArt(file: File, name?: string) {
    const formData = new FormData()
    formData.append('file', file)
    if (name) {
      formData.append('name', name)
    }
    return apiFetch<ILeResponse<IMapArtUploadData>>('/mapart/upload', {
      method: 'POST',
      body: formData,
    })
  }

  function getQuota() {
    return apiFetch<ILeResponse<IMapArtQuota>>('/mapart/quota', {
      method: 'GET',
    })
  }

  function getMapArtList() {
    return apiFetch<ILeResponse<IMapArtItem[]>>('/mapart/list', {
      method: 'GET',
    })
  }

  function deleteMapArt(id: number) {
    return apiFetch<ILeResponse<null>>('/mapart/delete', {
      method: 'POST',
      body: { id },
    })
  }

  async function getMapArtImage(id: number): Promise<string | null> {
    try {
      const token = sessionStorage.getItem('auth')
        ? JSON.parse(sessionStorage.getItem('auth')!)?.token
        : null
      const baseUrl = import.meta.env.VITE_SERVER_API_URL || ''
      const prefix = import.meta.env.VITE_SERVER_API_PREFIX || '/api'
      const url = `${baseUrl}${prefix}/mapart/image/${id}`

      const headers: Record<string, string> = {}
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }

      const res = await fetch(url, {
        headers,
        credentials: 'include',
      })

      if (!res.ok) return null
      const blob = await res.blob()
      return URL.createObjectURL(blob)
    }
    catch {
      return null
    }
  }

  function getMapArtAdminList(params?: IMapArtAdminListParams) {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.pageSize) query.set('pageSize', String(params.pageSize))
    if (params?.uid) query.set('uid', params.uid)
    const qs = query.toString()
    return apiFetch<ILeResponse<IMapArtAdminListData>>(`/mapart/admin/list${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    })
  }

  return { uploadMapArt, getMapArtList, deleteMapArt, getMapArtImage, getQuota, getMapArtAdminList }
}
