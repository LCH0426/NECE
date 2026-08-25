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

import type { Router } from 'vue-router'

import { storeToRefs } from 'pinia'

import pinia from '@/plugins/pinia/setup'
import { useAuthApi } from '@/services/api/auth.api'
import { useAuthStore } from '@/stores/auth'

let tokenVerified = false

export function setupAuthGuard(router: Router) {
  router.beforeEach(async (to, _from) => {
    const authStore = useAuthStore(pinia)
    const { isLogin } = storeToRefs(authStore)

    const publicPaths = ['/auth/sign-in', '/auth/otp', '/auth/forgot-password', '/errors', '/marketing']
    const isPublicPage = publicPaths.some(p => to.path.startsWith(p)) || to.meta.public === true

    if (isLogin.value && !tokenVerified) {
      try {
        const { verifyToken } = useAuthApi()
        const res = await verifyToken()
        if (res.code !== 200) {
          const { refreshToken } = useAuthApi()
          const refreshRes = await refreshToken()
          if (refreshRes.code === 200 && refreshRes.data?.token) {
            authStore.setAuth(refreshRes.data)
            tokenVerified = true
          }
          else {
            authStore.clearAuth()
            tokenVerified = false
            return {
              name: '/auth/sign-in',
              query: { redirect: to.fullPath },
            }
          }
        }
        else {
          tokenVerified = true
        }

        if (!authStore.name) {
          const { searchPlayer } = useAuthApi()
          try {
            const playerRes = await searchPlayer(authStore.uid!)
            if (playerRes.code === 200 && playerRes.data.players.length > 0) {
              authStore.setPlayerName(playerRes.data.players[0].name)
            }
          }
          catch {}
        }
      }
      catch {
        const { refreshToken } = useAuthApi()
        try {
          const refreshRes = await refreshToken()
          if (refreshRes.code === 200 && refreshRes.data?.token) {
            authStore.setAuth(refreshRes.data)
            tokenVerified = true
          }
          else {
            authStore.clearAuth()
            tokenVerified = false
            return {
              name: '/auth/sign-in',
              query: { redirect: to.fullPath },
            }
          }
        }
        catch {
          authStore.clearAuth()
          tokenVerified = false
          return {
            name: '/auth/sign-in',
            query: { redirect: to.fullPath },
          }
        }
      }
    }

    if (!isLogin.value && !isPublicPage) {
      const { refreshToken } = useAuthApi()
      try {
        const refreshRes = await refreshToken()
        if (refreshRes.code === 200 && refreshRes.data?.token) {
          authStore.setAuth(refreshRes.data)
          tokenVerified = true

          if (!authStore.name) {
            const { searchPlayer } = useAuthApi()
            try {
              const playerRes = await searchPlayer(authStore.uid!)
              if (playerRes.code === 200 && playerRes.data.players.length > 0) {
                authStore.setPlayerName(playerRes.data.players[0].name)
              }
            }
            catch {}
          }

          return
        }
      }
      catch {}

      return {
        name: '/auth/sign-in',
        query: { redirect: to.fullPath },
      }
    }

    if (isLogin.value && isPublicPage && !to.meta.public) {
      return { path: authStore.isAdmin ? '/dashboard' : '/messages' }
    }

    // 非管理员只能访问留言板、设置页、地图画上传和个人信息
    if (isLogin.value && !authStore.isAdmin) {
      const allowedPaths = ['/messages', '/settings', '/players/mapart', '/players/profile']
      const isAllowed = allowedPaths.some(p => to.path.startsWith(p))
      if (!isAllowed && !isPublicPage) {
        return { path: '/messages' }
      }
    }
  })
}
