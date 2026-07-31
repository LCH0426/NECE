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

/**
 * 前端本地物品数据管理
 *
 * 物品数据（name + texture）来自前端 public/textures/items.json，
 * 无需调用后端 /api/v1/items 接口。
 * 材质图片也在前端 public/textures/ 目录下，无需后端纹理 API。
 *
 * 数据加载策略：
 * - items.json 只加载一次（全局单例 + Promise 去重）
 * - 首次调用 getItemTexture / searchItems / getItemInfo / getItemName 时自动触发加载
 * - 页面无需手动调用 loadItemData()
 */

export interface IItemData {
  name: string
  texture: string
}

/**
 * 全局物品数据缓存（单例模式）
 */
const itemDataMap = ref<Record<string, IItemData>>({})
const itemDataLoaded = ref(false)
let loadPromise: Promise<void> | null = null

/**
 * 将 items.json 中的 texture 路径转为前端可直接使用的 URL
 */
function normalizeTexturePath(texture: string): string {
  let path = texture.replace(/^\/+/, '')
  if (!path.startsWith('textures/')) {
    path = `textures/${path}`
  }
  return `/${path}`
}

/**
 * 确保 items.json 已加载
 * 全局单例 + Promise 去重，保证只发起一次 fetch
 */
function ensureLoaded(): Promise<void> {
  if (itemDataLoaded.value)
    return Promise.resolve()
  if (loadPromise)
    return loadPromise

  loadPromise = (async () => {
    try {
      const res = await fetch('/textures/items.json')
      if (res.ok) {
        const data: Record<string, IItemData> = await res.json()
        // 规范化 texture 路径
        const normalized: Record<string, IItemData> = {}
        for (const [id, item] of Object.entries(data)) {
          normalized[id] = {
            name: item.name,
            texture: normalizeTexturePath(item.texture),
          }
        }
        itemDataMap.value = normalized
        itemDataLoaded.value = true
      }
    }
    catch {}
    finally {
      loadPromise = null
    }
  })()

  return loadPromise
}

export function useItemData() {
  /**
   * 手动触发加载（通常不需要调用，getItemTexture/searchItems 会自动加载）
   */
  async function loadItemData(): Promise<void> {
    return ensureLoaded()
  }

  /**
   * 根据物品ID获取物品信息（name + texture）
   * 支持带 minecraft: 前缀和不带前缀的ID
   */
  function getItemInfo(id: string): IItemData | undefined {
    if (!id || !itemDataMap.value)
      return undefined
    // 先直接查，再尝试去掉 minecraft: 前缀
    return itemDataMap.value[id] || itemDataMap.value[id.replace('minecraft:', '')]
  }

  /**
   * 根据物品ID获取材质路径
   * 如果数据尚未加载，触发加载（异步，本次调用可能返回 undefined，下次渲染时返回正确值）
   */
  function getItemTexture(id: string): string | undefined {
    if (!id)
      return undefined
    const result = getItemInfo(id)?.texture
    // 如果数据未加载，触发加载（不 await，让 Vue 响应式系统在数据加载后自动更新）
    if (!itemDataLoaded.value)
      ensureLoaded()
    return result
  }

  /**
   * 根据物品ID获取中文名称
   */
  function getItemName(id: string): string | undefined {
    if (!id)
      return undefined
    const result = getItemInfo(id)?.name
    if (!itemDataLoaded.value)
      ensureLoaded()
    return result
  }

  /**
   * 搜索物品，返回匹配的列表
   * 如果数据尚未加载，返回空数组并触发加载
   */
  function searchItems(query: string, limit = 20): { id: string, name: string, texture: string }[] {
    if (!query.trim())
      return []
    // 如果数据未加载，触发加载并返回空数组（下次渲染时会有数据）
    if (!itemDataLoaded.value) {
      ensureLoaded()
      return []
    }
    if (!itemDataMap.value)
      return []
    const q = query.toLowerCase()
    const results: { id: string, name: string, texture: string }[] = []
    for (const [id, data] of Object.entries(itemDataMap.value)) {
      if (id.toLowerCase().includes(q) || data.name.includes(query)) {
        results.push({ id, name: data.name, texture: data.texture })
        if (results.length >= limit)
          break
      }
    }
    return results
  }

  return {
    itemDataMap,
    itemDataLoaded,
    loadItemData,
    getItemInfo,
    getItemTexture,
    getItemName,
    searchItems,
  }
}
