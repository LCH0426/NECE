import { defineStore } from 'pinia'

export const usePluginInfoStore = defineStore('plugin-info', () => {
  const type = ref<'NEPE' | 'NECE' | null>(null)
  const version = ref<string | null>(null)
  const serverVersion = ref<string | null>(null)
  const protocol = ref<number | null>(null)

  const isNEPE = computed(() => type.value === 'NEPE')

  function setPluginInfo(data: { type: 'NEPE' | 'NECE', version: string, serverVersion: string, protocol: number }) {
    type.value = data.type
    version.value = data.version
    serverVersion.value = data.serverVersion
    protocol.value = data.protocol
  }

  function clearPluginInfo() {
    type.value = null
    version.value = null
    serverVersion.value = null
    protocol.value = null
  }

  return {
    type,
    version,
    serverVersion,
    protocol,
    isNEPE,
    setPluginInfo,
    clearPluginInfo,
  }
}, {
  persist: true,
})
