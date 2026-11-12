import { defineStore } from 'pinia'

export const usePluginInfoStore = defineStore('plugin-info', () => {
  const version = ref<string | null>(null)
  const serverVersion = ref<string | null>(null)
  const protocol = ref<number | null>(null)

  function setPluginInfo(data: { version: string, serverVersion: string, protocol: number }) {
    version.value = data.version
    serverVersion.value = data.serverVersion
    protocol.value = data.protocol
  }

  function clearPluginInfo() {
    version.value = null
    serverVersion.value = null
    protocol.value = null
  }

  return {
    version,
    serverVersion,
    protocol,
    setPluginInfo,
    clearPluginInfo,
  }
}, {
  persist: true,
})
