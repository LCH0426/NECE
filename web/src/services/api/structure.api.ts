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
import { API_BASE_URL } from '@/constants/app-config'
import { useAuthStore } from '@/stores/auth'

import type { ILeResponse } from '../types/response.type'

export interface IStructureItem {
  filename: string
  size: number
  sizeFormatted: string
  time: number
  timeFormatted: string
  type: 'mcstructure' | 'nbt'
}

export function useStructureApi() {
  const { apiFetch } = useApiFetch()

  function getStructureList() {
    return apiFetch<ILeResponse<IStructureItem[]>>('/structure/list', {
      method: 'GET',
    })
  }

  function deleteStructure(filename: string) {
    return apiFetch<ILeResponse<null>>(`/structure/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    })
  }

  function uploadStructure(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return apiFetch<ILeResponse<{ filename: string, size: number }>>('/structure/upload', {
      method: 'POST',
      body: formData,
    })
  }

  async function downloadStructure(filename: string): Promise<void> {
    const authStore = useAuthStore()
    const res = await fetch(`${API_BASE_URL}/structure/download/${encodeURIComponent(filename)}`, {
      headers: {
        Authorization: `Bearer ${authStore.token}`,
      },
    })
    if (!res.ok) {
      let msg = `下载失败 (${res.status})`
      try {
        const body = await res.json()
        if (body?.msg)
          msg = body.msg
      }
      catch {}
      throw new Error(msg)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return { getStructureList, deleteStructure, downloadStructure, uploadStructure }
}
