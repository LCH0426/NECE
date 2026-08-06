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

<script lang="ts" setup>
import { WrenchIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IMaintenanceStatus } from '@/services/api/system.api'

import { BasicPage } from '@/components/global-layout'
import { useSystemApi } from '@/services/api/system.api'

import EconomyContent from './components/economy-content.vue'
import PerformanceContent from './components/performance-content.vue'
import PlayerCountContent from './components/player-count-content.vue'

const tabs = ref([
  { name: '性能', value: 'performance' },
  { name: '经济', value: 'economy' },
  { name: '人数', value: 'player-count' },
])

const activeTab = ref(tabs.value[0].value)

const { getMaintenanceStatus, toggleMaintenance } = useSystemApi()

const maintenanceStatus = ref<IMaintenanceStatus | null>(null)
const maintenanceDialogOpen = ref(false)
const maintenanceReason = ref('')
const isToggling = ref(false)

async function fetchMaintenanceStatus() {
  try {
    const res = await getMaintenanceStatus()
    if (res.code === 200)
      maintenanceStatus.value = res.data
  }
  catch {}
}

async function handleToggleMaintenance(enable: boolean) {
  isToggling.value = true
  try {
    const res = await toggleMaintenance(enable, enable ? maintenanceReason.value : undefined)
    if (res.code === 200) {
      toast.success(enable ? '维护模式已启用' : '维护模式已关闭')
      if (enable && res.data.kickedPlayers)
        toast.info(`已踢出 ${res.data.kickedPlayers} 名玩家`)
      maintenanceDialogOpen.value = false
      maintenanceReason.value = ''
      await fetchMaintenanceStatus()
    }
    else {
      toast.error(res.msg || '操作失败')
    }
  }
  catch {
    toast.error('操作失败')
  }
  finally {
    isToggling.value = false
  }
}

function openMaintenanceDialog() {
  maintenanceReason.value = ''
  maintenanceDialogOpen.value = true
}

onMounted(() => {
  fetchMaintenanceStatus()
})
</script>

<template>
  <BasicPage
    title="总览"
    description="服务器状态监控"
    sticky
  >
    <UiTabs :default-value="activeTab" class="w-full">
      <div class="flex items-center justify-between">
        <UiTabsList>
          <UiTabsTrigger
            v-for="tab in tabs" :key="tab.value"
            :value="tab.value"
          >
            {{ tab.name }}
          </UiTabsTrigger>
        </UiTabsList>
        <UiButton variant="outline" size="sm" @click="openMaintenanceDialog">
          <span
            class="size-2 rounded-full mr-2"
            :class="maintenanceStatus?.enabled ? 'bg-orange-500' : 'bg-green-500'"
          />
          <WrenchIcon class="size-4 mr-1" />
          维护
        </UiButton>
      </div>
      <UiTabsContent value="performance" class="space-y-4">
        <PerformanceContent />
      </UiTabsContent>
      <UiTabsContent value="economy" class="space-y-4">
        <EconomyContent />
      </UiTabsContent>
      <UiTabsContent value="player-count" class="space-y-4">
        <PlayerCountContent />
      </UiTabsContent>
    </UiTabs>

    <UiDialog v-model:open="maintenanceDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>维护模式</UiDialogTitle>
          <UiDialogDescription>
            {{ maintenanceStatus?.enabled ? '当前处于维护状态' : '启用维护模式将踢出所有在线玩家' }}
          </UiDialogDescription>
        </UiDialogHeader>

        <div v-if="maintenanceStatus" class="space-y-4 py-4">
          <div class="flex items-center justify-between px-1">
            <span class="text-sm text-muted-foreground">当前状态</span>
            <UiBadge :variant="maintenanceStatus.enabled ? 'destructive' : 'default'">
              {{ maintenanceStatus.enabled ? '维护中' : '正常运行' }}
            </UiBadge>
          </div>
          <div v-if="maintenanceStatus.enabled && maintenanceStatus.reason" class="flex items-center justify-between px-1">
            <span class="text-sm text-muted-foreground">维护原因</span>
            <span class="text-sm font-medium">{{ maintenanceStatus.reason }}</span>
          </div>
          <div class="flex items-center justify-between px-1">
            <span class="text-sm text-muted-foreground">在线玩家</span>
            <span class="text-sm font-medium">{{ maintenanceStatus.onlinePlayers }} 人</span>
          </div>

          <template v-if="!maintenanceStatus.enabled">
            <UiSeparator />
            <div class="space-y-2">
              <label class="text-sm font-medium">维护原因（可选）</label>
              <UiInput
                v-model="maintenanceReason"
                placeholder="输入维护原因..."
              />
            </div>
            <div v-if="maintenanceStatus.onlinePlayers > 0" class="rounded-md bg-orange-500/10 p-3 text-sm text-orange-600">
              启用维护模式将踢出当前在线的 {{ maintenanceStatus.onlinePlayers }} 名玩家
            </div>
          </template>
        </div>

        <div v-else class="flex items-center justify-center py-8">
          <UiSpinner class="size-6" />
        </div>

        <UiDialogFooter>
          <UiButton variant="outline" @click="maintenanceDialogOpen = false">
            取消
          </UiButton>
          <template v-if="maintenanceStatus">
            <UiButton
              v-if="maintenanceStatus.enabled"
              variant="default"
              :disabled="isToggling"
              @click="handleToggleMaintenance(false)"
            >
              <UiSpinner v-if="isToggling" class="size-4 mr-2" />
              关闭维护模式
            </UiButton>
            <UiButton
              v-else
              variant="destructive"
              :disabled="isToggling"
              @click="handleToggleMaintenance(true)"
            >
              <UiSpinner v-if="isToggling" class="size-4 mr-2" />
              启用维护模式
            </UiButton>
          </template>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
