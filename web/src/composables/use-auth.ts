import { storeToRefs } from 'pinia'
import { toast } from 'vue-sonner'

import type { ICaptchaData, ILoginParams } from '@/services/api/auth.api'

import { useAuthApi, useCaptchaApi } from '@/services/api/auth.api'
import { usePlayerApi } from '@/services/api/player.api'
import { useAuthStore } from '@/stores/auth'

export function useAuth() {
  const router = useRouter()

  const authStore = useAuthStore()
  const { isLogin } = storeToRefs(authStore)
  const loading = ref(false)

  const captchaData = ref<ICaptchaData | null>(null)
  const captchaLoading = ref(false)

  const { getCaptcha } = useCaptchaApi()
  const { login: loginApi, verifyToken, getCurrentUser, searchPlayer, refreshToken, logout: logoutApi } = useAuthApi()
  const { getPlayerDetail } = usePlayerApi()

  async function refreshCaptcha() {
    captchaLoading.value = true
    try {
      const res = await getCaptcha()
      if (res.code === 200) {
        captchaData.value = res.data
      }
    }
    catch {
      toast.error('获取验证码失败')
    }
    finally {
      captchaLoading.value = false
    }
  }

  async function login(params: ILoginParams) {
    loading.value = true
    try {
      const res = await loginApi(params)
      if (res.code === 200) {
        authStore.setAuth(res.data)
        toast.success('登录成功')

        fetchPlayerName(res.data.uid)

        const redirect = router.currentRoute.value.query.redirect as string
        if (!redirect || redirect.startsWith('//')) {
          router.push({ path: '/dashboard' })
        }
        else {
          router.push(redirect)
        }
      }
      else {
        toast.error(res.msg || '登录失败')
        await refreshCaptcha()
      }
    }
    catch (error: any) {
      toast.error(error?.data?.msg || '登录失败，请检查网络连接')
      await refreshCaptcha()
    }
    finally {
      loading.value = false
    }
  }

  async function logout() {
    try {
      await logoutApi()
    }
    catch {}
    authStore.clearAuth()
    router.push({ path: '/auth/sign-in' })
  }

  async function checkAuth(): Promise<boolean> {
    if (!authStore.token)
      return false
    try {
      const res = await verifyToken()
      if (res.code === 200)
        return true
      const refreshRes = await refreshToken()
      if (refreshRes.code === 200 && refreshRes.data?.token) {
        authStore.setAuth(refreshRes.data)
        return true
      }
      authStore.clearAuth()
      return false
    }
    catch {
      authStore.clearAuth()
      return false
    }
  }

  async function fetchCurrentUser() {
    try {
      const res = await getCurrentUser()
      if (res.code === 200) {
        authStore.setUserInfo(res.data)
        if (!authStore.name || !authStore.avatarUrl) {
          fetchPlayerName(res.data.uid)
        }
      }
    }
    catch {}
  }

  async function fetchPlayerName(playerUid: string) {
    try {
      const res = await searchPlayer(playerUid)
      if (res.code === 200 && res.data.players.length > 0) {
        authStore.setPlayerName(res.data.players[0].name)
        fetchAvatar(res.data.players[0].xuid)
      }
    }
    catch {}
  }

  async function fetchAvatar(xuid: string) {
    try {
      const res = await getPlayerDetail(xuid)
      if (res.code === 200 && res.data.playerData?.avatar) {
        const avatar = res.data.playerData.avatar
        if (typeof avatar === 'object' && avatar.type === 'qq' && avatar.value) {
          authStore.setAvatarUrl(`https://q1.qlogo.cn/g?b=qq&nk=${avatar.value}&s=100`)
        }
      }
    }
    catch {}
  }

  return {
    loading,
    captchaData,
    captchaLoading,
    isLogin,
    login,
    logout,
    refreshCaptcha,
    checkAuth,
    fetchCurrentUser,
  }
}
