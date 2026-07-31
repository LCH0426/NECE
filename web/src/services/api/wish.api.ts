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

export interface IWishReward {
  name: string
  snbt: string
  description?: string
}

export interface IWishCoreShopItem {
  name: string
  snbt: string
  cost: number
  description: string
  icon: string
}

export interface IWishRates {
  fiveStar: number
  fourStar: number
  fiveStarSoftPity: number
  fiveStarHardPity: number
  fourStarGuarantee: number
}

export interface IWishCost {
  single: number
  ten: number
}

export interface IWishConfig {
  dustName: string
  coreName: string
  description: string
  rates: IWishRates
  cost: IWishCost
  rewards: {
    threeStar: { minDust: number, maxDust: number }
    fourStar: IWishReward[]
    fiveStar: IWishReward[]
  }
  coreShop: IWishCoreShopItem[]
}

export function useWishApi() {
  const { apiFetch } = useApiFetch()

  function getWishConfig() {
    return apiFetch<ILeResponse<IWishConfig>>('/wish', {
      method: 'GET',
    })
  }

  function updateThreeStar(data: { minDust?: number, maxDust?: number }) {
    return apiFetch<ILeResponse<{ minDust: number, maxDust: number }>>('/wish/threeStar', {
      method: 'PUT',
      body: data,
    })
  }

  function updateRates(data: { fiveStar?: number, fourStar?: number, fiveStarSoftPity?: number, fiveStarHardPity?: number, fourStarGuarantee?: number }) {
    return apiFetch<ILeResponse<IWishRates>>('/wish/rates', {
      method: 'PUT',
      body: data,
    })
  }

  function updateCost(data: { single?: number, ten?: number }) {
    return apiFetch<ILeResponse<IWishCost>>('/wish/cost', {
      method: 'PUT',
      body: data,
    })
  }

  function updateNames(data: { dustName?: string, coreName?: string }) {
    return apiFetch<ILeResponse<{ dustName: string, coreName: string }>>('/wish/names', {
      method: 'PUT',
      body: data,
    })
  }

  function updateDescription(description: string) {
    return apiFetch<ILeResponse<{ description: string }>>('/wish/description', {
      method: 'PUT',
      body: { description },
    })
  }

  function addFourStar(data: { name: string, snbt: string }) {
    return apiFetch<ILeResponse<IWishReward>>('/wish/fourStar', {
      method: 'POST',
      body: data,
    })
  }

  function updateFourStar(index: number, data: { name?: string, snbt?: string }) {
    return apiFetch<ILeResponse<IWishReward>>(`/wish/fourStar/${index}`, {
      method: 'PUT',
      body: data,
    })
  }

  function deleteFourStar(index: number) {
    return apiFetch<ILeResponse<null>>(`/wish/fourStar/${index}`, {
      method: 'DELETE',
    })
  }

  function addFiveStar(data: { name: string, snbt: string, description?: string }) {
    return apiFetch<ILeResponse<IWishReward>>('/wish/fiveStar', {
      method: 'POST',
      body: data,
    })
  }

  function updateFiveStar(index: number, data: { name?: string, snbt?: string, description?: string }) {
    return apiFetch<ILeResponse<IWishReward>>(`/wish/fiveStar/${index}`, {
      method: 'PUT',
      body: data,
    })
  }

  function deleteFiveStar(index: number) {
    return apiFetch<ILeResponse<null>>(`/wish/fiveStar/${index}`, {
      method: 'DELETE',
    })
  }

  function addCoreShopItem(data: { name: string, snbt: string, cost: number, description?: string, icon?: string }) {
    return apiFetch<ILeResponse<IWishCoreShopItem>>('/wish/coreShop', {
      method: 'POST',
      body: data,
    })
  }

  function updateCoreShopItem(index: number, data: { name?: string, snbt?: string, cost?: number, description?: string, icon?: string }) {
    return apiFetch<ILeResponse<IWishCoreShopItem>>(`/wish/coreShop/${index}`, {
      method: 'PUT',
      body: data,
    })
  }

  function deleteCoreShopItem(index: number) {
    return apiFetch<ILeResponse<null>>(`/wish/coreShop/${index}`, {
      method: 'DELETE',
    })
  }

  return {
    getWishConfig,
    updateThreeStar,
    updateRates,
    updateCost,
    updateNames,
    updateDescription,
    addFourStar,
    updateFourStar,
    deleteFourStar,
    addFiveStar,
    updateFiveStar,
    deleteFiveStar,
    addCoreShopItem,
    updateCoreShopItem,
    deleteCoreShopItem,
  }
}
