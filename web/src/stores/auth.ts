import { defineStore } from 'pinia'

import type { IUserInfo } from '@/services/api/auth.api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const uid = ref<string | null>(null)
  const name = ref<string | null>(null)
  const role = ref<string | null>(null)
  const isAdmin = ref(false)
  const avatarUrl = ref<string | null>(null)
  const isLogin = computed(() => !!token.value)
  const displayName = computed(() => {
    return name.value || uid.value || ''
  })

  function setAuth(data: { token: string, uid: string, role: string }) {
    token.value = data.token
    uid.value = data.uid
    role.value = data.role
    isAdmin.value = data.role === 'admin'
  }

  function setUserInfo(info: IUserInfo) {
    uid.value = info.uid
    role.value = info.role
    isAdmin.value = info.isAdmin
  }

  function setPlayerName(playerName: string) {
    name.value = playerName
  }

  function setAvatarUrl(url: string | null) {
    avatarUrl.value = url
  }

  function clearAuth() {
    token.value = null
    uid.value = null
    name.value = null
    role.value = null
    isAdmin.value = false
    avatarUrl.value = null
  }

  return {
    token,
    uid,
    name,
    role,
    isAdmin,
    isLogin,
    displayName,
    avatarUrl,
    setAuth,
    setUserInfo,
    setPlayerName,
    setAvatarUrl,
    clearAuth,
  }
}, {
  persist: true,
})
