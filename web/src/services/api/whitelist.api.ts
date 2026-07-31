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

import type { ILeResponse, IRequestQuery } from '../types/response.type'

export interface IWhitelistItem {
  name: string
  xuid: string
  ignoresPlayerLimit: boolean
}

export interface IWhitelistListData {
  list: IWhitelistItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export function useWhitelistApi() {
  const { apiFetch } = useApiFetch()

  function getWhitelist(query?: IRequestQuery<{ search: string }>) {
    return apiFetch<ILeResponse<IWhitelistListData>>('/allowlist', {
      method: 'GET',
      params: query,
    })
  }

  function addWhitelist(data: { name: string }) {
    return apiFetch<ILeResponse<{ name: string, xuid: string }>>('/allowlist', {
      method: 'POST',
      body: data,
    })
  }

  function deleteWhitelist(data: { name: string }) {
    return apiFetch<ILeResponse<null>>('/allowlist', {
      method: 'DELETE',
      body: data,
    })
  }

  return { getWhitelist, addWhitelist, deleteWhitelist }
}
