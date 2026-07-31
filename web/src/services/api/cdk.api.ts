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

export interface ICdkReward {
  type: 'item' | 'snbt' | 'money'
  itemId?: string
  itemName?: string
  count?: number
  snbt?: string
  amount?: number
}

export interface ICdkItem {
  code: string
  maxUses: number
  usedCount: number
  rewards: ICdkReward[]
}

export function useCdkApi() {
  const { apiFetch } = useApiFetch()

  function getCdkList() {
    return apiFetch<ILeResponse<ICdkItem[]>>('/cdk/list', {
      method: 'GET',
    })
  }

  function addCdk(data: {
    code: string
    maxUses?: number
    rewards?: ICdkReward[]
    type?: string
    itemId?: string
    itemName?: string
    count?: number
    snbt?: string
    amount?: number
  }) {
    return apiFetch<ILeResponse<null>>('/cdk/add', {
      method: 'POST',
      body: data,
    })
  }

  function modifyCdk(data: {
    code: string
    maxUses?: number
    rewards?: ICdkReward[]
  }) {
    return apiFetch<ILeResponse<null>>('/cdk/modify', {
      method: 'POST',
      body: data,
    })
  }

  function deleteCdk(code: string) {
    return apiFetch<ILeResponse<null>>('/cdk/delete', {
      method: 'POST',
      body: { code },
    })
  }

  return { getCdkList, addCdk, modifyCdk, deleteCdk }
}
