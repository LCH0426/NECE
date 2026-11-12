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

export interface IBanStatus {
  banned: boolean
  reason?: string
  entry?: {
    name: string
    uid: number
    ip: string
    reason: string
    operator: string
    time: string
    banned: boolean
  }
}

export interface IPlayer {
  uid: number
  name: string
  xuid: string
  registerTime: string
  balance: number
  isOnline: boolean
  isBanned: IBanStatus
  playTime: number
  vipExpire: number | null
  lastIp: string
  platform: string
}

export interface IPlayerListPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface IPlayerListData {
  players: IPlayer[]
  pagination: IPlayerListPagination
}

export interface IPlayerRankData {
  players: IPlayer[]
  sort: {
    field: string
    order: string
  }
  pagination: IPlayerListPagination
}

export interface IOnlinePlayer {
  name: string
  xuid: string
  uuid: string
  ip: string
  dimension: number
  position: { x: number, y: number, z: number }
  balance: number
  gameMode: number
  ping: number
  platform: string
  os?: string
}

export interface IOnlinePlayerData {
  players: IOnlinePlayer[]
  count: number
}

export interface IPlayerDetailPlayerData {
  [key: string]: any
}

export interface IPlayerDetail {
  uid: number
  name: string
  xuid: string
  uuid: string
  registerTime: string
  balance: number
  isOnline: boolean
  onlineInfo: {
    ip: string
    dimension: number
    position: { x: number, y: number, z: number }
    gameMode: number
    ping: number
  } | null
  lastIp: string
  platform: string
  playerData: IPlayerDetailPlayerData
}

export interface IMoneyOperationResult {
  xuid: string
  name: string
  action: string
  amount: number
  before: number
  after: number
}

export interface IGameModeResult {
  name: string
  xuid: string
  oldMode: number
  oldModeName: string
  newMode: number
  newModeName: string
}

export interface IMailItem {
  id: number
  fromName: string
  fromXuid: string
  toXuid: string
  toName: string
  content: string
  time: string
  starQian: number
  hasItems: boolean
  itemCount: number
  isGlobal: boolean
  isScheduled: boolean
  scheduledTime: string | null
  read: number | boolean
  readCount: number
  claimedCount: number
}

export interface IMailListData {
  mails: IMailItem[]
  pagination: IPlayerListPagination
}

export interface IMailDetail {
  id: number
  fromName: string
  fromXuid: string
  toXuid: string
  toName: string
  content: string
  time: string
  starQian: number
  items: { snbt: string, name: string, count: number }[]
  isGlobal: boolean
  isScheduled: boolean
  scheduledTime: string | null
  read: Record<string, boolean> | boolean
  readList: { xuid: string, name: string }[]
  claimed: Record<string, boolean> | boolean
  claimedList: { xuid: string, name: string }[]
}

export interface ISendMailResult {
  id: number
  toXuid: string
  toName: string
}

export interface IAllMoneyData {
  totalMoney: number
  playerCount: number
  cached: boolean
}

export interface IBehaviorLogEntry {
  time: string
  dim: string
  source: string
  x: string
  y: string
  z: string
  event: string
  target: string
  tx: string
  ty: string
  tz: string
  extra: string
}

export interface IBehaviorLogData {
  entries: IBehaviorLogEntry[]
  pagination: IPlayerListPagination
  date: string
}

export interface IBehaviorEvent {
  key: string
  name: string
}

export interface IChatMessage {
  time: number
  sender: string
  message: string
  type: string
}

export interface IChatHistoryData {
  messages: IChatMessage[]
  pagination: IPlayerListPagination
  date: string
}

export interface ILogEntry {
  time: string
  level: string
  event: string
  date?: string
  [key: string]: any
}

export interface ILogQueryData {
  entries: ILogEntry[]
  pagination: IPlayerListPagination
  range: {
    startDate: string
    endDate: string
    startTime: string
    endTime: string
  }
}

export interface ILogQuery {
  startDate?: string
  endDate?: string
  startTime?: string
  endTime?: string
  levels?: string
  event?: string
  player?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export function usePlayerApi() {
  const { apiFetch } = useApiFetch()

  function getPlayers(query?: IRequestQuery<{ search: string }>) {
    return apiFetch<ILeResponse<IPlayerListData>>('/players', {
      method: 'GET',
      params: query,
    })
  }

  function getPlayersRankUid(query?: IRequestQuery<{ order: string }>) {
    return apiFetch<ILeResponse<IPlayerRankData>>('/players/rank/uid', {
      method: 'GET',
      params: query,
    })
  }

  function getPlayersRankPlaytime(query?: IRequestQuery<{ order: string }>) {
    return apiFetch<ILeResponse<IPlayerRankData>>('/players/rank/playtime', {
      method: 'GET',
      params: query,
    })
  }

  function getPlayersRankBalance(query?: IRequestQuery<{ order: string }>) {
    return apiFetch<ILeResponse<IPlayerRankData>>('/players/rank/balance', {
      method: 'GET',
      params: query,
    })
  }

  function getOnlinePlayers() {
    return apiFetch<ILeResponse<IOnlinePlayerData>>('/players/online', {
      method: 'GET',
    })
  }

  function getPlayerDetail(xuid: string) {
    return apiFetch<ILeResponse<IPlayerDetail>>(`/players/${xuid}`, {
      method: 'GET',
    })
  }

  function moneyOperation(xuid: string, action: 'add' | 'reduce' | 'set', amount: number) {
    return apiFetch<ILeResponse<IMoneyOperationResult>>('/players/money', {
      method: 'POST',
      body: { xuid, action, amount },
    })
  }

  function kickPlayer(xuid: string, reason?: string) {
    return apiFetch<ILeResponse<null>>('/players/kick', {
      method: 'POST',
      body: { xuid, reason },
    })
  }

  function crashPlayer(identifier: string) {
    return apiFetch<ILeResponse<{ name: string, xuid: string }>>('/players/crash', {
      method: 'POST',
      body: { identifier },
    })
  }

  function lightningPlayer(player: string) {
    return apiFetch<ILeResponse<null>>('/lightning', {
      method: 'POST',
      body: { player },
    })
  }

  function changeGameMode(xuid: string, mode: string) {
    return apiFetch<ILeResponse<IGameModeResult>>(`/players/${xuid}/gamemode`, {
      method: 'PUT',
      body: { mode },
    })
  }

  function updatePlayerUid(xuid: string, uid: string) {
    return apiFetch<ILeResponse<{ xuid: string, uid: number, name: string }>>(`/players/${xuid}/uid`, {
      method: 'PUT',
      body: { uid },
    })
  }

  function sendPopup(xuid: string, content: string) {
    return apiFetch<ILeResponse<null>>('/players/popup', {
      method: 'POST',
      body: { xuid, content },
    })
  }

  function sendChatMessage(message: string) {
    return apiFetch<ILeResponse<null>>('/chat/send', {
      method: 'POST',
      body: { message },
    })
  }

  function getAllMoney() {
    return apiFetch<ILeResponse<IAllMoneyData>>('/allmoney', {
      method: 'GET',
    })
  }

  function getMails(query?: IRequestQuery<{ type: string, search: string }>) {
    return apiFetch<ILeResponse<IMailListData>>('/mails', {
      method: 'GET',
      params: query,
    })
  }

  function getMailDetail(id: number) {
    return apiFetch<ILeResponse<IMailDetail>>(`/mails/${id}`, {
      method: 'GET',
    })
  }

  function sendMail(data: {
    toXuid: string
    content: string
    starQian?: number
    scheduledTime?: string
    items?: { type: string, id?: string, snbt?: string, count?: number }[]
  }) {
    return apiFetch<ILeResponse<ISendMailResult>>('/mails/send', {
      method: 'POST',
      body: data,
    })
  }

  function getCurrencyName() {
    return apiFetch<ILeResponse<{ name: string }>>('/currency-name', {
      method: 'GET',
    })
  }

  function deleteMail(id: number) {
    return apiFetch<ILeResponse<null>>(`/mails/${id}`, {
      method: 'DELETE',
    })
  }

  function getBehaviorLogs(query?: { date?: string, player?: string, eventType?: string, page?: number, pageSize?: number }) {
    return apiFetch<ILeResponse<IBehaviorLogData>>('/behavior/logs', {
      method: 'GET',
      params: query,
    })
  }

  function getBehaviorDates() {
    return apiFetch<ILeResponse<{ dates: string[] }>>('/behavior/dates', {
      method: 'GET',
    })
  }

  function getBehaviorEvents() {
    return apiFetch<ILeResponse<{ events: IBehaviorEvent[] }>>('/behavior/events', {
      method: 'GET',
    })
  }

  function getChatHistory(query?: { limit?: number, before?: number, after?: number }) {
    return apiFetch<ILeResponse<{ messages: IChatMessage[], total: number }>>('/chat/history', {
      method: 'GET',
      params: query,
    })
  }

  function getChatLog(query?: { date?: string, page?: number, pageSize?: number, sender?: string, keyword?: string }) {
    return apiFetch<ILeResponse<IChatHistoryData>>('/chat/log', {
      method: 'GET',
      params: query,
    })
  }

  function getChatLogDates() {
    return apiFetch<ILeResponse<{ dates: string[] }>>('/chat/log/dates', {
      method: 'GET',
    })
  }

  function getSystemLogs(query?: ILogQuery) {
    return apiFetch<ILeResponse<ILogQueryData>>('/logs', {
      method: 'GET',
      params: query,
    })
  }

  function getLogDates() {
    return apiFetch<ILeResponse<{ dates: string[] }>>('/logs/dates', {
      method: 'GET',
    })
  }

  async function getPlayerNamesByXuids(xuids: string[]): Promise<Map<string, string>> {
    const nameMap = new Map<string, string>()
    const results = await Promise.allSettled(
      xuids.map(xuid => getPlayerDetail(xuid)),
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.code === 200) {
        nameMap.set(result.value.data.xuid, result.value.data.name)
      }
    }
    return nameMap
  }

  function getPlayerTitles(xuid: string) {
    return apiFetch<ILeResponse<{ xuid: string, owned: string[], active: string | null }>>(`/players/${xuid}/titles`, {
      method: 'GET',
    })
  }

  function addPlayerTitle(xuid: string, title: string) {
    return apiFetch<ILeResponse<{ xuid: string, title: string }>>(`/players/${xuid}/titles`, {
      method: 'POST',
      body: { title },
    })
  }

  function setActiveTitle(xuid: string, title: string) {
    return apiFetch<ILeResponse<{ xuid: string, active: string }>>(`/players/${xuid}/titles/active`, {
      method: 'PUT',
      body: { title },
    })
  }

  function deletePlayerTitle(xuid: string, title: string) {
    return apiFetch<ILeResponse<null>>(`/players/${xuid}/titles/${encodeURIComponent(title)}`, {
      method: 'DELETE',
    })
  }

  return {
    getPlayers,
    getPlayersRankUid,
    getPlayersRankPlaytime,
    getPlayersRankBalance,
    getOnlinePlayers,
    getPlayerDetail,
    moneyOperation,
    kickPlayer,
    crashPlayer,
    lightningPlayer,
    changeGameMode,
    updatePlayerUid,
    sendPopup,
    sendChatMessage,
    getAllMoney,
    getMails,
    getMailDetail,
    sendMail,
    deleteMail,
    getCurrencyName,
    getBehaviorLogs,
    getBehaviorDates,
    getBehaviorEvents,
    getChatHistory,
    getChatLog,
    getChatLogDates,
    getSystemLogs,
    getLogDates,
    getPlayerNamesByXuids,
    getPlayerTitles,
    addPlayerTitle,
    setActiveTitle,
    deletePlayerTitle,
  }
}
