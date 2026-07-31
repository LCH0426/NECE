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

export interface ICaptchaData {
  captchaId: string
  svg: string
}

export interface ILoginParams {
  uid: string
  password: string
  captchaId: string
  captchaCode: string
}

export interface ILoginData {
  token: string
  uid: string
  role: string
}

export interface IVerifyData {
  uid: string
  role: string
  exp: number
}

export interface IUserInfo {
  uid: string
  role: string
  isAdmin: boolean
}

export interface IPlayerInfo {
  uid: number
  name: string
  xuid: string
  registerTime: string
  balance: number
  isOnline: boolean
  playTime: number
  vipExpire: number
  lastIp: string
  platform: string
}

export interface IPlayersResponse {
  players: IPlayerInfo[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export function useCaptchaApi() {
  const { apiFetch } = useApiFetch()

  function getCaptcha() {
    return apiFetch<ILeResponse<ICaptchaData>>('/captcha', {
      method: 'GET',
    })
  }

  return { getCaptcha }
}

export function useAuthApi() {
  const { apiFetch } = useApiFetch()

  function login(params: ILoginParams) {
    return apiFetch<ILeResponse<ILoginData>>('/auth/login', {
      method: 'POST',
      body: params,
    })
  }

  function refreshToken() {
    return apiFetch<ILeResponse<ILoginData>>('/auth/refresh', {
      method: 'POST',
    })
  }

  function logout() {
    return apiFetch<ILeResponse<null>>('/auth/logout', {
      method: 'POST',
    })
  }

  function verifyToken() {
    return apiFetch<ILeResponse<IVerifyData>>('/auth/verify', {
      method: 'GET',
    })
  }

  function getCurrentUser() {
    return apiFetch<ILeResponse<IUserInfo>>('/users/me', {
      method: 'GET',
    })
  }

  function searchPlayer(uid: string) {
    return apiFetch<ILeResponse<IPlayersResponse>>(`/players?search=${uid}&page=1&pageSize=1`, {
      method: 'GET',
    })
  }

  return { login, refreshToken, logout, verifyToken, getCurrentUser, searchPlayer }
}
