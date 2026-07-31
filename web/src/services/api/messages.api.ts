import { useApiFetch } from '@/composables/use-fetch'

import type { ILeResponse } from '../types/response.type'

export interface IMessage {
  id: number
  xuid: string
  playerName: string
  msg: string
  mood: string
  time: string
  client: string
  isDeleted: boolean
  canDelete?: boolean
}

export interface IMessageListParams {
  page?: number
  pageSize?: number
  search?: string
  mood?: string
  includeDeleted?: boolean
  xuid?: string
}

export interface IMessageListResponse {
  messages: IMessage[]
  // 嵌套格式
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  // 扁平格式（兼容）
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

export interface IMessageCreateParams {
  content: string
  mood?: string
}

export function useMessagesApi() {
  const { apiFetch } = useApiFetch()

  function getMessages(params?: IMessageListParams) {
    const query = new URLSearchParams()
    if (params?.page)
      query.set('page', String(params.page))
    if (params?.pageSize)
      query.set('pageSize', String(params.pageSize))
    if (params?.search)
      query.set('search', params.search)
    if (params?.mood)
      query.set('mood', params.mood)
    if (params?.includeDeleted)
      query.set('includeDeleted', 'true')

    return apiFetch<ILeResponse<IMessageListResponse>>(`/messages?${query.toString()}`, {
      method: 'GET',
    })
  }

  function getAllMessages(params?: IMessageListParams) {
    const query = new URLSearchParams()
    if (params?.page)
      query.set('page', String(params.page))
    if (params?.pageSize)
      query.set('pageSize', String(params.pageSize))
    if (params?.search)
      query.set('search', params.search)
    if (params?.mood)
      query.set('mood', params.mood)
    if (params?.xuid)
      query.set('xuid', params.xuid)
    if (params?.includeDeleted)
      query.set('includeDeleted', 'true')

    return apiFetch<ILeResponse<IMessageListResponse>>(`/messages/all?${query.toString()}`, {
      method: 'GET',
    })
  }

  function getMessageDetail(id: number) {
    return apiFetch<ILeResponse<IMessage>>(`/messages/${id}`, {
      method: 'GET',
    })
  }

  function createMessage(data: IMessageCreateParams) {
    return apiFetch<ILeResponse<{ id: number }>>('/messages', {
      method: 'POST',
      body: data,
    })
  }

  function deleteMessage(id: number) {
    return apiFetch<ILeResponse<null>>(`/messages/${id}`, {
      method: 'DELETE',
    })
  }

  return { getMessages, getAllMessages, getMessageDetail, createMessage, deleteMessage }
}
