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
 * 前端本地材质 URL 工具
 *
 * 所有材质图片已存放在 public/textures/ 目录下，
 * 无需调用后端纹理 API，直接使用前端静态资源路径即可。
 *
 * 本地路径规则：
 * - public/textures/items/   → 物品材质
 * - public/textures/blocks/  → 方块材质
 *
 * Vite 会将 public/ 目录下的文件原样复制到构建输出，
 * 因此在开发 (dev) 和生产 (build) 阶段均可通过 /textures/... 访问。
 */

// 获取基础路径（本地为 /，远程部署可能为 /panel/）
const BASE_URL = import.meta.env.VITE_BASE || '/'

/**
 * 将材质路径转换为前端可直接使用的本地 URL
 *
 * 支持的输入路径格式：
 * - "/textures/items/diamond.png"
 * - "textures/items/diamond.png"
 * - "items/diamond.png"
 * - "diamond.png" (默认 items 目录)
 *
 * @returns 绝对路径 URL，如 "/panel/textures/items/diamond.png"
 */
function texturePathToLocalUrl(texturePath: string): string | null {
  if (!texturePath)
    return null

  const normalized = texturePath.replace(/^\/+/, '')

  // 安全检查
  if (normalized.includes('..'))
    return null

  // 基础路径处理（确保首尾有 /）
  let base = BASE_URL
  if (!base.startsWith('/'))
    base = `/${base}`
  if (!base.endsWith('/'))
    base = `${base}/`

  let result: string

  // 已经是完整路径（textures/items/... 或 textures/blocks/...）
  if (normalized.startsWith('textures/')) {
    result = `${base}${normalized}`
  }
  // 已经包含 items/ 或 blocks/ 子目录前缀
  else if (normalized.startsWith('items/') || normalized.startsWith('blocks/')) {
    result = `${base}textures/${normalized}`
  }
  // 没有子目录前缀，默认尝试 items 目录
  else {
    result = `${base}textures/items/${normalized}`
  }

  // 确保返回绝对路径（以 / 开头）
  return result.startsWith('/') ? result : `/${result}`
}

export function useTexture() {
  /**
   * 将材质路径转换为前端本地 URL
   * 直接返回静态资源路径，浏览器会自动缓存
   */
  function getTextureUrl(texturePath: string | undefined | null): string | null {
    if (!texturePath)
      return null
    return texturePathToLocalUrl(texturePath)
  }

  return { getTextureUrl }
}
