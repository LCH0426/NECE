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

export interface IRecycleItem {
  id: string
  name: string
  image: string
  price: number
}

export interface IItemSearchResult {
  id: string
  name: string
  image: string
}

export function useRecycleApi() {
  const { apiFetch } = useApiFetch()

  function getRecycleList() {
    return apiFetch<ILeResponse<IRecycleItem[]>>('/recycle', {
      method: 'GET',
    })
  }

  function addRecycleItem(data: { id: string, price: number }) {
    return apiFetch<ILeResponse<IRecycleItem>>('/recycle', {
      method: 'POST',
      body: data,
    })
  }

  function updateRecycleItem(id: string, price: number) {
    return apiFetch<ILeResponse<IRecycleItem>>(`/recycle/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { price },
    })
  }

  function deleteRecycleItem(id: string) {
    return apiFetch<ILeResponse<null>>(`/recycle/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  function searchItems(keyword: string) {
    return apiFetch<ILeResponse<IItemSearchResult[]>>('/items/search', {
      method: 'GET',
      params: { keyword },
    })
  }

  return { getRecycleList, addRecycleItem, updateRecycleItem, deleteRecycleItem, searchItems }
}
