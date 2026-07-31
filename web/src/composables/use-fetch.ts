import { ofetch } from 'ofetch'
import { toast } from 'vue-sonner'

import { API_BASE_URL } from '@/constants/app-config'
import { useAuthStore } from '@/stores/auth'

interface ILeResponse<T> {
  code: number
  msg?: string
  data?: T
}

function getAuthToken(): string | null {
  try {
    const authStore = useAuthStore()
    return authStore.token
  }
  catch {
    const raw = sessionStorage.getItem('auth')
    if (!raw)
      return null
    try {
      const parsed = JSON.parse(raw)
      return parsed?.token ?? null
    }
    catch {
      return null
    }
  }
}

function clearAuthAndRedirect() {
  try {
    const authStore = useAuthStore()
    authStore.clearAuth()
  }
  catch {
    sessionStorage.removeItem('auth')
  }
  toast.error('登录已过期，请重新登录')
  // 延迟重定向，让用户看到 toast
  const base = import.meta.env.BASE_URL || '/'
  setTimeout(() => {
    window.location.href = `${base}auth/sign-in`
  }, 1500)
}

function setAuthFromRefresh(data: { token: string, uid: string, role: string }) {
  try {
    const authStore = useAuthStore()
    authStore.setAuth(data)
  }
  catch {
    const raw = sessionStorage.getItem('auth')
    let storeData: Record<string, any> = {}
    if (raw) {
      try {
        storeData = JSON.parse(raw)
      }
      catch {}
    }
    storeData.token = data.token
    storeData.uid = data.uid
    storeData.role = data.role
    storeData.isAdmin = data.role === 'admin'
    sessionStorage.setItem('auth', JSON.stringify(storeData))
  }
}

let isRefreshing = false
let refreshPromise: Promise<{ token: string, uid: string, role: string } | null> | null = null

async function tryRefreshToken(): Promise<{ token: string, uid: string, role: string } | null> {
  if (isRefreshing && refreshPromise)
    return refreshPromise

  isRefreshing = true
  refreshPromise = (async () => {
    try {
      const res = await ofetch<{ code: number, msg?: string, data?: { token: string, uid: string, role: string } }>(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.code === 200 && res.data?.token) {
        setAuthFromRefresh(res.data)
        return res.data
      }
      return null
    }
    catch {
      return null
    }
    finally {
      isRefreshing = false
      refreshPromise = null
    }
  })()

  return refreshPromise
}

async function fetchWithAuth<T>(url: string, options: any): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {}
  if (options.headers && !(options.headers instanceof Headers) && !Array.isArray(options.headers)) {
    Object.assign(headers, options.headers)
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  try {
    const res = await ofetch<ILeResponse<any>>(`${API_BASE_URL}${url}`, {
      ...options,
      headers,
      credentials: 'include',
    })
    // 后端返回 HTTP 200 + { code: 401 } 的情况，ofetch 不会抛异常
    if (res?.code === 401) {
      const refreshResult = await tryRefreshToken()
      if (refreshResult) {
        headers.Authorization = `Bearer ${refreshResult.token}`
        return await ofetch<T>(`${API_BASE_URL}${url}`, {
          ...options,
          headers,
          credentials: 'include',
        })
      }
      else {
        clearAuthAndRedirect()
        throw new Error('登录已过期，请重新登录')
      }
    }
    return res as T
  }
  catch (error: any) {
    // HTTP 级别的 401（ofetch 抛异常）
    if (error?.statusCode === 401 || error?.response?.status === 401) {
      const refreshResult = await tryRefreshToken()
      if (refreshResult) {
        headers.Authorization = `Bearer ${refreshResult.token}`
        return await ofetch<T>(`${API_BASE_URL}${url}`, {
          ...options,
          headers,
          credentials: 'include',
        })
      }
      else {
        clearAuthAndRedirect()
        throw new Error('登录已过期，请重新登录')
      }
    }
    throw error
  }
}

export function useApiFetch() {
  return {
    apiFetch: fetchWithAuth as <T>(url: string, options: any) => Promise<T>,
  }
}
