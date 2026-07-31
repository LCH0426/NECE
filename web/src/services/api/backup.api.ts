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

export interface IBackupItem {
  filename: string
  size: number
  sizeFormatted: string
  time: number
  timeFormatted: string
  world: string
  type: 'world' | 'data'
  downloadUrl: string
}

export interface IBackupStats {
  count: number
  totalSize: number
  totalSizeFormatted: string
  backups: IBackupItem[]
}

export interface IBackupStatus {
  isRunning: boolean
}

export interface IBackupResult {
  world: string
  file: string
  success: boolean
  error?: string
}

export interface IBackupExecuteResult {
  results: IBackupResult[]
  timestamp: string
  elapsed: string
  totalSize: number
  totalSizeFormatted: string
}

export interface IBackupConfig {
  compressionLevel: number
  interval: number
  maxAgeDays: number
  maxCount: number
  dataBackupInterval: number
}

export interface IDataBackupResult {
  filename: string
  size: number
  duration: number
  time: string
}

export interface IDownloadTokenResult {
  downloadUrl: string
  token: string
  expiresIn: number
}

export function useBackupApi() {
  const { apiFetch } = useApiFetch()

  function getBackupConfig() {
    return apiFetch<ILeResponse<IBackupConfig>>('/backup/config', {
      method: 'GET',
    })
  }

  function updateBackupConfig(data: Partial<IBackupConfig>) {
    return apiFetch<ILeResponse<IBackupConfig>>('/backup/config', {
      method: 'PUT',
      body: data,
    })
  }

  function getBackupStats() {
    return apiFetch<ILeResponse<IBackupStats>>('/backup/stats', {
      method: 'GET',
    })
  }

  function getBackupList() {
    return apiFetch<ILeResponse<IBackupItem[]>>('/backup/list', {
      method: 'GET',
    })
  }

  function getBackupStatus() {
    return apiFetch<ILeResponse<IBackupStatus>>('/backup/status', {
      method: 'GET',
    })
  }

  function executeBackup() {
    return apiFetch<ILeResponse<IBackupExecuteResult>>('/backup/execute', {
      method: 'POST',
    })
  }

  function deleteBackup(filename: string) {
    return apiFetch<ILeResponse<null>>(`/backup/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    })
  }

  function executeDataBackup() {
    return apiFetch<ILeResponse<IDataBackupResult>>('/backup/data', {
      method: 'POST',
    })
  }

  function requestDownloadToken(filename: string) {
    return apiFetch<ILeResponse<IDownloadTokenResult>>('/backup/download-token', {
      method: 'POST',
      body: { filename },
    })
  }

  return { getBackupConfig, updateBackupConfig, getBackupStats, getBackupList, getBackupStatus, executeBackup, deleteBackup, executeDataBackup, requestDownloadToken }
}
