import { useApiFetch } from '@/composables/use-fetch'

import type { ILeResponse } from '../types/response.type'

export interface IDeleteCaptcha {
  captchaId: string
  svg: string
  message: string
}

export interface IDeletePlayerDataParams {
  xuid: string
  captchaId: string
  captchaCode: string
}

export function useDangerApi() {
  const { apiFetch } = useApiFetch()

  function getDeleteCaptcha() {
    return apiFetch<ILeResponse<IDeleteCaptcha>>('/admin/player/delete-captcha', {
      method: 'GET',
    })
  }

  function deletePlayerData(data: IDeletePlayerDataParams) {
    return apiFetch<ILeResponse<null>>('/admin/player/delete-all', {
      method: 'POST',
      body: data,
    })
  }

  return { getDeleteCaptcha, deletePlayerData }
}
