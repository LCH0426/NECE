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

export interface IShopGroup {
  index: number
  name: string
  image: string
  itemCount: number
}

export interface IShopItem {
  index: number
  id: string
  name: string
  image: string
  money: number
}

export interface IItemSearchResult {
  id: string
  name: string
  image: string
}

export function useShopApi() {
  const { apiFetch } = useApiFetch()

  function getShopData(group?: string) {
    return apiFetch<ILeResponse<any[]>>('/shop', {
      method: 'GET',
      params: group ? { group } : undefined,
    })
  }

  function getShopGroups(group: string) {
    return apiFetch<ILeResponse<IShopGroup[]>>('/shop/groups', {
      method: 'GET',
      params: { group },
    })
  }

  function addShopGroup(data: { group: string, name: string, image?: string }) {
    return apiFetch<ILeResponse<null>>('/shop/group', {
      method: 'POST',
      body: data,
    })
  }

  function updateShopGroup(groupIdx: number, data: { group: string, name?: string, image?: string }) {
    return apiFetch<ILeResponse<null>>(`/shop/group/${groupIdx}`, {
      method: 'PUT',
      body: data,
    })
  }

  function deleteShopGroup(groupIdx: number, group: string) {
    return apiFetch<ILeResponse<null>>(`/shop/group/${groupIdx}`, {
      method: 'DELETE',
      params: { group },
    })
  }

  function getShopItems(group: string, groupIdx: number) {
    return apiFetch<ILeResponse<IShopItem[]>>('/shop/items', {
      method: 'GET',
      params: { group, groupIdx },
    })
  }

  function addShopItem(data: { group: string, groupIdx: number, id: string, money: number, image?: string }) {
    return apiFetch<ILeResponse<null>>('/shop/item', {
      method: 'POST',
      body: data,
    })
  }

  function updateShopItem(itemIdx: number, data: { group: string, groupIdx: number, id?: string, money?: number, image?: string }) {
    return apiFetch<ILeResponse<null>>(`/shop/item/${itemIdx}`, {
      method: 'PUT',
      body: data,
    })
  }

  function deleteShopItem(itemIdx: number, group: string, groupIdx: number) {
    return apiFetch<ILeResponse<null>>(`/shop/item/${itemIdx}`, {
      method: 'DELETE',
      params: { group, groupIdx },
    })
  }

  function searchItems(keyword: string) {
    return apiFetch<ILeResponse<IItemSearchResult[]>>('/items/search', {
      method: 'GET',
      params: { keyword },
    })
  }

  return {
    getShopData,
    getShopGroups,
    addShopGroup,
    updateShopGroup,
    deleteShopGroup,
    getShopItems,
    addShopItem,
    updateShopItem,
    deleteShopItem,
    searchItems,
  }
}
