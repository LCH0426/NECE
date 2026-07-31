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

<script setup lang="ts">
import { PencilIcon, PlusIcon, TrashIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IWishConfig, IWishCoreShopItem, IWishReward } from '@/services/api/wish.api'

import { BasicPage } from '@/components/global-layout'
import { useWishApi } from '@/services/api/wish.api'

const {
  getWishConfig,
  updateThreeStar,
  updateRates,
  updateCost,
  updateNames,
  updateDescription,
  addFourStar,
  updateFourStar,
  deleteFourStar,
  addFiveStar,
  updateFiveStar,
  deleteFiveStar,
  addCoreShopItem,
  updateCoreShopItem,
  deleteCoreShopItem,
} = useWishApi()

const config = ref<IWishConfig | null>(null)
const loading = ref(true)
const activeTab = ref('settings')

async function fetchConfig() {
  loading.value = true
  try {
    const res = await getWishConfig()
    if (res.code === 200)
      config.value = res.data
  }
  catch {
    toast.error('获取祈愿配置失败')
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchConfig()
})

const actionLoading = ref(false)
const actionError = ref('')
const actionResult = ref('')

const threeStarEditOpen = ref(false)
const threeStarForm = reactive({ minDust: 0, maxDust: 0 })

function openThreeStarEdit() {
  threeStarForm.minDust = config.value?.rewards.threeStar.minDust ?? 0
  threeStarForm.maxDust = config.value?.rewards.threeStar.maxDust ?? 0
  actionError.value = ''
  actionResult.value = ''
  threeStarEditOpen.value = true
}

async function handleUpdateThreeStar() {
  actionLoading.value = true
  actionError.value = ''
  try {
    const data: { minDust?: number, maxDust?: number } = {}
    if (threeStarForm.minDust !== config.value?.rewards.threeStar.minDust)
      data.minDust = threeStarForm.minDust
    if (threeStarForm.maxDust !== config.value?.rewards.threeStar.maxDust)
      data.maxDust = threeStarForm.maxDust
    if (Object.keys(data).length === 0) {
      threeStarEditOpen.value = false
      return
    }
    const res = await updateThreeStar(data)
    if (res.code === 200) {
      actionResult.value = '修改成功'
      fetchConfig()
    }
    else {
      actionError.value = res.msg || '修改失败'
    }
  }
  catch {
    actionError.value = '修改失败'
  }
  finally {
    actionLoading.value = false
  }
}

const ratesEditOpen = ref(false)
const ratesForm = reactive({ fiveStar: 0, fourStar: 0, fiveStarSoftPity: 0, fiveStarHardPity: 0, fourStarGuarantee: 0 })

function openRatesEdit() {
  ratesForm.fiveStar = config.value?.rates.fiveStar ?? 0
  ratesForm.fourStar = config.value?.rates.fourStar ?? 0
  ratesForm.fiveStarSoftPity = config.value?.rates.fiveStarSoftPity ?? 0
  ratesForm.fiveStarHardPity = config.value?.rates.fiveStarHardPity ?? 0
  ratesForm.fourStarGuarantee = config.value?.rates.fourStarGuarantee ?? 0
  actionError.value = ''
  actionResult.value = ''
  ratesEditOpen.value = true
}

async function handleUpdateRates() {
  actionLoading.value = true
  actionError.value = ''
  try {
    const data: Record<string, number> = {}
    if (ratesForm.fiveStar !== config.value?.rates.fiveStar)
      data.fiveStar = ratesForm.fiveStar
    if (ratesForm.fourStar !== config.value?.rates.fourStar)
      data.fourStar = ratesForm.fourStar
    if (ratesForm.fiveStarSoftPity !== config.value?.rates.fiveStarSoftPity)
      data.fiveStarSoftPity = ratesForm.fiveStarSoftPity
    if (ratesForm.fiveStarHardPity !== config.value?.rates.fiveStarHardPity)
      data.fiveStarHardPity = ratesForm.fiveStarHardPity
    if (ratesForm.fourStarGuarantee !== config.value?.rates.fourStarGuarantee)
      data.fourStarGuarantee = ratesForm.fourStarGuarantee
    if (Object.keys(data).length === 0) {
      ratesEditOpen.value = false
      return
    }
    const res = await updateRates(data)
    if (res.code === 200) {
      actionResult.value = '修改成功'
      fetchConfig()
    }
    else {
      actionError.value = res.msg || '修改失败'
    }
  }
  catch {
    actionError.value = '修改失败'
  }
  finally {
    actionLoading.value = false
  }
}

const costEditOpen = ref(false)
const costForm = reactive({ single: 0, ten: 0 })

function openCostEdit() {
  costForm.single = config.value?.cost.single ?? 0
  costForm.ten = config.value?.cost.ten ?? 0
  actionError.value = ''
  actionResult.value = ''
  costEditOpen.value = true
}

async function handleUpdateCost() {
  actionLoading.value = true
  actionError.value = ''
  try {
    const data: Record<string, number> = {}
    if (costForm.single !== config.value?.cost.single)
      data.single = costForm.single
    if (costForm.ten !== config.value?.cost.ten)
      data.ten = costForm.ten
    if (Object.keys(data).length === 0) {
      costEditOpen.value = false
      return
    }
    const res = await updateCost(data)
    if (res.code === 200) {
      actionResult.value = '修改成功'
      fetchConfig()
    }
    else {
      actionError.value = res.msg || '修改失败'
    }
  }
  catch {
    actionError.value = '修改失败'
  }
  finally {
    actionLoading.value = false
  }
}

const namesEditOpen = ref(false)
const namesForm = reactive({ dustName: '', coreName: '' })

function openNamesEdit() {
  namesForm.dustName = config.value?.dustName ?? ''
  namesForm.coreName = config.value?.coreName ?? ''
  actionError.value = ''
  actionResult.value = ''
  namesEditOpen.value = true
}

async function handleUpdateNames() {
  actionLoading.value = true
  actionError.value = ''
  try {
    const data: Record<string, string> = {}
    if (namesForm.dustName !== config.value?.dustName)
      data.dustName = namesForm.dustName
    if (namesForm.coreName !== config.value?.coreName)
      data.coreName = namesForm.coreName
    if (Object.keys(data).length === 0) {
      namesEditOpen.value = false
      return
    }
    const res = await updateNames(data)
    if (res.code === 200) {
      actionResult.value = '修改成功'
      fetchConfig()
    }
    else {
      actionError.value = res.msg || '修改失败'
    }
  }
  catch {
    actionError.value = '修改失败'
  }
  finally {
    actionLoading.value = false
  }
}

const descEditOpen = ref(false)
const descText = ref('')

function openDescEdit() {
  descText.value = config.value?.description || ''
  actionError.value = ''
  actionResult.value = ''
  descEditOpen.value = true
}

async function handleUpdateDesc() {
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await updateDescription(descText.value)
    if (res.code === 200) {
      actionResult.value = '修改成功'
      fetchConfig()
    }
    else {
      actionError.value = res.msg || '修改失败'
    }
  }
  catch {
    actionError.value = '修改失败'
  }
  finally {
    actionLoading.value = false
  }
}

const rewardDialogOpen = ref(false)
const rewardType = ref<'fourStar' | 'fiveStar'>('fourStar')
const rewardMode = ref<'add' | 'edit'>('add')
const rewardIndex = ref(-1)
const rewardForm = reactive({ name: '', snbt: '', description: '' })

function openAddReward(type: 'fourStar' | 'fiveStar') {
  rewardType.value = type
  rewardMode.value = 'add'
  rewardForm.name = ''
  rewardForm.snbt = ''
  rewardForm.description = ''
  actionError.value = ''
  actionResult.value = ''
  rewardDialogOpen.value = true
}

function openEditReward(type: 'fourStar' | 'fiveStar', index: number, item: IWishReward) {
  rewardType.value = type
  rewardMode.value = 'edit'
  rewardIndex.value = index
  rewardForm.name = item.name
  rewardForm.snbt = item.snbt
  rewardForm.description = item.description || ''
  actionError.value = ''
  actionResult.value = ''
  rewardDialogOpen.value = true
}

async function handleRewardSubmit() {
  actionLoading.value = true
  actionError.value = ''
  try {
    let res: any
    if (rewardMode.value === 'add') {
      if (rewardType.value === 'fourStar')
        res = await addFourStar({ name: rewardForm.name, snbt: rewardForm.snbt })
      else
        res = await addFiveStar({ name: rewardForm.name, snbt: rewardForm.snbt, description: rewardForm.description || undefined })
    }
    else {
      const data: Record<string, string> = {}
      const list = rewardType.value === 'fourStar' ? config.value?.rewards.fourStar : config.value?.rewards.fiveStar
      const original = list?.[rewardIndex.value]
      if (original) {
        if (rewardForm.name !== original.name)
          data.name = rewardForm.name
        if (rewardForm.snbt !== original.snbt)
          data.snbt = rewardForm.snbt
        if (rewardType.value === 'fiveStar' && rewardForm.description !== (original.description || ''))
          data.description = rewardForm.description
      }
      if (rewardType.value === 'fourStar')
        res = await updateFourStar(rewardIndex.value, data)
      else
        res = await updateFiveStar(rewardIndex.value, data)
    }
    if (res.code === 200) {
      actionResult.value = rewardMode.value === 'add' ? '添加成功' : '修改成功'
      fetchConfig()
    }
    else {
      actionError.value = res.msg || '操作失败'
    }
  }
  catch {
    actionError.value = '操作失败'
  }
  finally {
    actionLoading.value = false
  }
}

const deleteRewardDialogOpen = ref(false)
const deleteRewardTarget = ref<{ type: 'fourStar' | 'fiveStar', index: number } | null>(null)
const deleteRewardLoading = ref(false)

function openDeleteRewardDialog(type: 'fourStar' | 'fiveStar', index: number) {
  deleteRewardTarget.value = { type, index }
  deleteRewardDialogOpen.value = true
}

async function confirmDeleteReward() {
  if (!deleteRewardTarget.value)
    return
  deleteRewardLoading.value = true
  try {
    const { type, index } = deleteRewardTarget.value
    const res = type === 'fourStar' ? await deleteFourStar(index) : await deleteFiveStar(index)
    if (res.code === 200) {
      toast.success('删除成功')
      fetchConfig()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleteRewardLoading.value = false
    deleteRewardDialogOpen.value = false
  }
}

const coreDialogOpen = ref(false)
const coreMode = ref<'add' | 'edit'>('add')
const coreIndex = ref(-1)
const coreForm = reactive({ name: '', snbt: '', cost: 1, description: '', icon: '' })

function openAddCore() {
  coreMode.value = 'add'
  coreForm.name = ''
  coreForm.snbt = ''
  coreForm.cost = 1
  coreForm.description = ''
  coreForm.icon = ''
  actionError.value = ''
  actionResult.value = ''
  coreDialogOpen.value = true
}

function openEditCore(index: number, item: IWishCoreShopItem) {
  coreMode.value = 'edit'
  coreIndex.value = index
  coreForm.name = item.name
  coreForm.snbt = item.snbt
  coreForm.cost = item.cost
  coreForm.description = item.description
  coreForm.icon = item.icon
  actionError.value = ''
  actionResult.value = ''
  coreDialogOpen.value = true
}

async function handleCoreSubmit() {
  actionLoading.value = true
  actionError.value = ''
  try {
    let res: any
    if (coreMode.value === 'add') {
      const data: { name: string, snbt: string, cost: number, description?: string, icon?: string } = { name: coreForm.name, snbt: coreForm.snbt, cost: coreForm.cost }
      if (coreForm.description)
        data.description = coreForm.description
      if (coreForm.icon)
        data.icon = coreForm.icon
      res = await addCoreShopItem(data)
    }
    else {
      const data: { name?: string, snbt?: string, cost?: number, description?: string, icon?: string } = {}
      const original = config.value?.coreShop[coreIndex.value]
      if (original) {
        if (coreForm.name !== original.name)
          data.name = coreForm.name
        if (coreForm.snbt !== original.snbt)
          data.snbt = coreForm.snbt
        if (coreForm.cost !== original.cost)
          data.cost = coreForm.cost
        if (coreForm.description !== original.description)
          data.description = coreForm.description
        if (coreForm.icon !== original.icon)
          data.icon = coreForm.icon
      }
      res = await updateCoreShopItem(coreIndex.value, data)
    }
    if (res.code === 200) {
      actionResult.value = coreMode.value === 'add' ? '添加成功' : '修改成功'
      fetchConfig()
    }
    else {
      actionError.value = res.msg || '操作失败'
    }
  }
  catch {
    actionError.value = '操作失败'
  }
  finally {
    actionLoading.value = false
  }
}

const deleteCoreDialogOpen = ref(false)
const deleteCoreIndex = ref(-1)
const deleteCoreLoading = ref(false)

function openDeleteCoreDialog(index: number) {
  deleteCoreIndex.value = index
  deleteCoreDialogOpen.value = true
}

async function confirmDeleteCore() {
  deleteCoreLoading.value = true
  try {
    const res = await deleteCoreShopItem(deleteCoreIndex.value)
    if (res.code === 200) {
      toast.success('删除成功')
      fetchConfig()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleteCoreLoading.value = false
    deleteCoreDialogOpen.value = false
  }
}
</script>

<template>
  <BasicPage title="祈愿管理" description="管理祈愿系统卡池、奖励和星核兑换商店">
    <div v-if="loading" class="flex items-center justify-center py-12">
      <UiSpinner class="size-6" />
    </div>

    <div v-else-if="config" class="space-y-6 overflow-hidden">
      <UiTabs v-model="activeTab">
        <div class="flex items-center justify-between">
          <UiTabsList>
            <UiTabsTrigger value="settings">
              基础设置
            </UiTabsTrigger>
            <UiTabsTrigger value="fourStar">
              四星奖励
            </UiTabsTrigger>
            <UiTabsTrigger value="fiveStar">
              五星奖励
            </UiTabsTrigger>
            <UiTabsTrigger value="coreShop">
              星核兑换
            </UiTabsTrigger>
          </UiTabsList>
          <UiButton variant="outline" size="sm" @click="fetchConfig">
            刷新
          </UiButton>
        </div>

        <UiTabsContent value="settings" class="mt-4 min-w-0">
          <div class="space-y-4">
            <div class="border rounded-lg p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium">
                  自定义名称
                </h3>
                <UiButton size="sm" @click="openNamesEdit">
                  <PencilIcon class="size-4 mr-1" />
                  修改
                </UiButton>
              </div>
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span class="text-muted-foreground">星尘名称：</span>{{ config.dustName }}
                </div>
                <div>
                  <span class="text-muted-foreground">星核名称：</span>{{ config.coreName }}
                </div>
              </div>
            </div>

            <div class="border rounded-lg p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium">
                  三星物品（星尘产出）
                </h3>
                <UiButton size="sm" @click="openThreeStarEdit">
                  <PencilIcon class="size-4 mr-1" />
                  修改
                </UiButton>
              </div>
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span class="text-muted-foreground">最小产出：</span>{{ config.rewards.threeStar.minDust }} {{ config.dustName }}
                </div>
                <div>
                  <span class="text-muted-foreground">最大产出：</span>{{ config.rewards.threeStar.maxDust }} {{ config.dustName }}
                </div>
              </div>
            </div>

            <div class="border rounded-lg p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium">
                  概率与保底
                </h3>
                <UiButton size="sm" @click="openRatesEdit">
                  <PencilIcon class="size-4 mr-1" />
                  修改
                </UiButton>
              </div>
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span class="text-muted-foreground">五星基础概率：</span>{{ (config.rates.fiveStar * 100).toFixed(1) }}%
                </div>
                <div>
                  <span class="text-muted-foreground">四星基础概率：</span>{{ (config.rates.fourStar * 100).toFixed(1) }}%
                </div>
                <div>
                  <span class="text-muted-foreground">五星软保底：</span>第{{ config.rates.fiveStarSoftPity }}抽起
                </div>
                <div>
                  <span class="text-muted-foreground">五星硬保底：</span>第{{ config.rates.fiveStarHardPity }}抽
                </div>
                <div>
                  <span class="text-muted-foreground">四星保底：</span>第{{ config.rates.fourStarGuarantee }}抽
                </div>
              </div>
            </div>

            <div class="border rounded-lg p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium">
                  祈愿花费
                </h3>
                <UiButton size="sm" @click="openCostEdit">
                  <PencilIcon class="size-4 mr-1" />
                  修改
                </UiButton>
              </div>
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span class="text-muted-foreground">单抽花费：</span>{{ config.cost.single }}
                </div>
                <div>
                  <span class="text-muted-foreground">十连花费：</span>{{ config.cost.ten }}
                </div>
              </div>
            </div>

            <div class="border rounded-lg p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium">
                  系统说明
                </h3>
                <UiButton size="sm" @click="openDescEdit">
                  <PencilIcon class="size-4 mr-1" />
                  修改
                </UiButton>
              </div>
              <div class="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">
                {{ config.description }}
              </div>
              <div class="text-xs text-muted-foreground">
                支持模板变量：{coreName}、{dustName}、{minDust}、{maxDust}，支持Minecraft颜色代码§
              </div>
            </div>
          </div>
        </UiTabsContent>

        <UiTabsContent value="fourStar" class="mt-4 min-w-0">
          <div class="border rounded-lg overflow-hidden">
            <div class="flex items-center justify-between p-4 border-b">
              <h3 class="text-sm font-medium">
                四星奖励列表 ({{ config.rewards.fourStar.length }})
              </h3>
              <UiButton size="sm" @click="openAddReward('fourStar')">
                <PlusIcon class="size-4 mr-1" />
                添加
              </UiButton>
            </div>
            <div v-if="config.rewards.fourStar.length === 0" class="p-4 text-center text-muted-foreground text-sm">
              暂无四星奖励
            </div>
            <div
              v-for="(item, i) in config.rewards.fourStar"
              :key="i"
              class="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 overflow-hidden"
            >
              <span class="text-xs text-muted-foreground w-8 shrink-0">{{ i }}</span>
              <span class="min-w-0 flex-1 text-sm font-medium truncate">{{ item.name }}</span>
              <span class="text-xs text-muted-foreground font-mono truncate min-w-0 shrink">{{ item.snbt }}</span>
              <UiButton variant="ghost" size="icon" class="size-8 shrink-0" @click="openEditReward('fourStar', i, item)">
                <PencilIcon class="size-4" />
              </UiButton>
              <UiButton variant="ghost" size="icon" class="size-8 shrink-0 text-destructive" @click="openDeleteRewardDialog('fourStar', i)">
                <TrashIcon class="size-4" />
              </UiButton>
            </div>
          </div>
        </UiTabsContent>

        <UiTabsContent value="fiveStar" class="mt-4 min-w-0">
          <div class="border rounded-lg overflow-hidden">
            <div class="flex items-center justify-between p-4 border-b">
              <h3 class="text-sm font-medium">
                五星奖励列表 ({{ config.rewards.fiveStar.length }})
              </h3>
              <UiButton size="sm" @click="openAddReward('fiveStar')">
                <PlusIcon class="size-4 mr-1" />
                添加
              </UiButton>
            </div>
            <div v-if="config.rewards.fiveStar.length === 0" class="p-4 text-center text-muted-foreground text-sm">
              暂无五星奖励
            </div>
            <div
              v-for="(item, i) in config.rewards.fiveStar"
              :key="i"
              class="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 overflow-hidden"
            >
              <span class="text-xs text-muted-foreground w-8 shrink-0">{{ i }}</span>
              <div class="min-w-0 flex-1">
                <span class="text-sm font-medium truncate block">{{ item.name }}</span>
                <div v-if="item.description" class="text-xs text-muted-foreground truncate">
                  {{ item.description }}
                </div>
              </div>
              <span class="text-xs text-muted-foreground font-mono truncate min-w-0 shrink">{{ item.snbt }}</span>
              <UiButton variant="ghost" size="icon" class="size-8 shrink-0" @click="openEditReward('fiveStar', i, item)">
                <PencilIcon class="size-4" />
              </UiButton>
              <UiButton variant="ghost" size="icon" class="size-8 shrink-0 text-destructive" @click="openDeleteRewardDialog('fiveStar', i)">
                <TrashIcon class="size-4" />
              </UiButton>
            </div>
          </div>
        </UiTabsContent>

        <UiTabsContent value="coreShop" class="mt-4 min-w-0">
          <div class="border rounded-lg overflow-hidden">
            <div class="flex items-center justify-between p-4 border-b">
              <h3 class="text-sm font-medium">
                星核兑换商店 ({{ config.coreShop.length }})
              </h3>
              <UiButton size="sm" @click="openAddCore">
                <PlusIcon class="size-4 mr-1" />
                添加
              </UiButton>
            </div>
            <div v-if="config.coreShop.length === 0" class="p-4 text-center text-muted-foreground text-sm">
              暂无兑换物品
            </div>
            <div
              v-for="(item, i) in config.coreShop"
              :key="i"
              class="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 overflow-hidden"
            >
              <span class="text-xs text-muted-foreground w-8 shrink-0">{{ i }}</span>
              <span class="min-w-0 flex-1 text-sm font-medium truncate">{{ item.name }}</span>
              <span class="text-sm text-primary font-mono shrink-0">{{ item.cost }}{{ config.coreName }}</span>
              <span class="text-xs text-muted-foreground truncate min-w-0 shrink">{{ item.description }}</span>
              <UiButton variant="ghost" size="icon" class="size-8 shrink-0" @click="openEditCore(i, item)">
                <PencilIcon class="size-4" />
              </UiButton>
              <UiButton variant="ghost" size="icon" class="size-8 shrink-0 text-destructive" @click="openDeleteCoreDialog(i)">
                <TrashIcon class="size-4" />
              </UiButton>
            </div>
          </div>
        </UiTabsContent>
      </UiTabs>

      <UiDialog v-model:open="threeStarEditOpen">
        <UiDialogContent class="sm:max-w-[425px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>修改三星物品（星尘产出）</UiDialogTitle>
          </UiDialogHeader>
          <div v-if="!actionResult" class="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <div class="space-y-2">
              <label class="text-sm font-medium">最小产出数量</label>
              <UiInput v-model="threeStarForm.minDust" type="number" placeholder="0" :min="0" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">最大产出数量</label>
              <UiInput v-model="threeStarForm.maxDust" type="number" placeholder="0" :min="0" />
            </div>
            <div v-if="actionError" class="text-sm text-destructive">
              {{ actionError }}
            </div>
          </div>
          <div v-else class="py-4">
            <div class="rounded-md bg-muted p-3 text-sm">
              {{ actionResult }}
            </div>
          </div>
          <UiDialogFooter>
            <UiButton variant="outline" @click="threeStarEditOpen = false">
              {{ actionResult ? '关闭' : '取消' }}
            </UiButton>
            <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleUpdateThreeStar">
              {{ actionLoading ? '保存中...' : '保存' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>

      <UiDialog v-model:open="ratesEditOpen">
        <UiDialogContent class="sm:max-w-[500px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>修改概率与保底</UiDialogTitle>
          </UiDialogHeader>
          <div v-if="!actionResult" class="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <div class="space-y-2">
              <label class="text-sm font-medium">五星基础概率（0-1之间，如0.006）</label>
              <UiInput v-model="ratesForm.fiveStar" type="number" step="0.001" placeholder="0.006" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">四星基础概率（0-1之间，如0.051）</label>
              <UiInput v-model="ratesForm.fourStar" type="number" step="0.001" placeholder="0.051" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">五星软保底起始次数</label>
              <UiInput v-model="ratesForm.fiveStarSoftPity" type="number" placeholder="73" :min="1" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">五星硬保底次数</label>
              <UiInput v-model="ratesForm.fiveStarHardPity" type="number" placeholder="90" :min="1" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">四星保底次数</label>
              <UiInput v-model="ratesForm.fourStarGuarantee" type="number" placeholder="10" :min="1" />
            </div>
            <div v-if="actionError" class="text-sm text-destructive">
              {{ actionError }}
            </div>
          </div>
          <div v-else class="py-4">
            <div class="rounded-md bg-muted p-3 text-sm">
              {{ actionResult }}
            </div>
          </div>
          <UiDialogFooter>
            <UiButton variant="outline" @click="ratesEditOpen = false">
              {{ actionResult ? '关闭' : '取消' }}
            </UiButton>
            <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleUpdateRates">
              {{ actionLoading ? '保存中...' : '保存' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>

      <UiDialog v-model:open="costEditOpen">
        <UiDialogContent class="sm:max-w-[425px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>修改祈愿花费</UiDialogTitle>
          </UiDialogHeader>
          <div v-if="!actionResult" class="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <div class="space-y-2">
              <label class="text-sm font-medium">单抽花费</label>
              <UiInput v-model="costForm.single" type="number" placeholder="160" :min="0" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">十连花费</label>
              <UiInput v-model="costForm.ten" type="number" placeholder="1600" :min="0" />
            </div>
            <div v-if="actionError" class="text-sm text-destructive">
              {{ actionError }}
            </div>
          </div>
          <div v-else class="py-4">
            <div class="rounded-md bg-muted p-3 text-sm">
              {{ actionResult }}
            </div>
          </div>
          <UiDialogFooter>
            <UiButton variant="outline" @click="costEditOpen = false">
              {{ actionResult ? '关闭' : '取消' }}
            </UiButton>
            <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleUpdateCost">
              {{ actionLoading ? '保存中...' : '保存' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>

      <UiDialog v-model:open="namesEditOpen">
        <UiDialogContent class="sm:max-w-[425px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>修改自定义名称</UiDialogTitle>
          </UiDialogHeader>
          <div v-if="!actionResult" class="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <div class="space-y-2">
              <label class="text-sm font-medium">星尘名称</label>
              <UiInput v-model="namesForm.dustName" placeholder="星尘" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">星核名称</label>
              <UiInput v-model="namesForm.coreName" placeholder="星核" />
            </div>
            <div v-if="actionError" class="text-sm text-destructive">
              {{ actionError }}
            </div>
          </div>
          <div v-else class="py-4">
            <div class="rounded-md bg-muted p-3 text-sm">
              {{ actionResult }}
            </div>
          </div>
          <UiDialogFooter>
            <UiButton variant="outline" @click="namesEditOpen = false">
              {{ actionResult ? '关闭' : '取消' }}
            </UiButton>
            <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleUpdateNames">
              {{ actionLoading ? '保存中...' : '保存' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>

      <UiDialog v-model:open="descEditOpen">
        <UiDialogContent class="sm:max-w-[500px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>修改系统说明</UiDialogTitle>
          </UiDialogHeader>
          <div v-if="!actionResult" class="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <UiTextarea v-model="descText" placeholder="输入祈愿系统说明（支持模板变量：{coreName}、{dustName}、{minDust}、{maxDust}，支持§颜色代码）" :rows="8" />
            <div class="text-xs text-muted-foreground">
              支持模板变量：{coreName}、{dustName}、{minDust}、{maxDust}，支持Minecraft颜色代码§
            </div>
            <div v-if="actionError" class="text-sm text-destructive">
              {{ actionError }}
            </div>
          </div>
          <div v-else class="py-4">
            <div class="rounded-md bg-muted p-3 text-sm">
              {{ actionResult }}
            </div>
          </div>
          <UiDialogFooter>
            <UiButton variant="outline" @click="descEditOpen = false">
              {{ actionResult ? '关闭' : '取消' }}
            </UiButton>
            <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleUpdateDesc">
              {{ actionLoading ? '保存中...' : '保存' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>

      <UiDialog v-model:open="rewardDialogOpen">
        <UiDialogContent class="sm:max-w-[500px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>{{ rewardMode === 'add' ? '添加' : '修改' }}{{ rewardType === 'fourStar' ? '四星' : '五星' }}奖励</UiDialogTitle>
          </UiDialogHeader>
          <div v-if="!actionResult" class="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <div class="space-y-2">
              <label class="text-sm font-medium">物品名称 *</label>
              <UiInput v-model="rewardForm.name" placeholder="输入物品名称" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">SNBT数据 *</label>
              <UiTextarea v-model="rewardForm.snbt" placeholder="{&quot;Count&quot;:1b,&quot;Damage&quot;:0s,&quot;Name&quot;:&quot;minecraft:redstone&quot;,&quot;WasPickedUp&quot;:0b}" :rows="3" class="w-full" />
            </div>
            <div v-if="rewardType === 'fiveStar'" class="space-y-2">
              <label class="text-sm font-medium">描述（命星定轨显示）</label>
              <UiInput v-model="rewardForm.description" placeholder="可选，用于命星定轨展示" />
            </div>
            <div v-if="actionError" class="text-sm text-destructive">
              {{ actionError }}
            </div>
          </div>
          <div v-else class="py-4">
            <div class="rounded-md bg-muted p-3 text-sm">
              {{ actionResult }}
            </div>
          </div>
          <UiDialogFooter>
            <UiButton variant="outline" @click="rewardDialogOpen = false">
              {{ actionResult ? '关闭' : '取消' }}
            </UiButton>
            <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleRewardSubmit">
              {{ actionLoading ? '处理中...' : '确认' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>

      <UiDialog v-model:open="coreDialogOpen">
        <UiDialogContent class="sm:max-w-[500px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>{{ coreMode === 'add' ? '添加' : '修改' }}星核兑换物品</UiDialogTitle>
          </UiDialogHeader>
          <div v-if="!actionResult" class="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <div class="space-y-2">
              <label class="text-sm font-medium">物品名称 *</label>
              <UiInput v-model="coreForm.name" placeholder="输入物品名称" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">SNBT数据 *</label>
              <UiTextarea v-model="coreForm.snbt" placeholder="{&quot;Count&quot;:1b,&quot;Damage&quot;:0s,&quot;Name&quot;:&quot;minecraft:redstone&quot;,&quot;WasPickedUp&quot;:0b}" :rows="3" class="w-full" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">兑换所需星核数 *</label>
              <UiInput v-model="coreForm.cost" type="number" placeholder="1" :min="1" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">物品描述</label>
              <UiInput v-model="coreForm.description" placeholder="可选" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">图标纹理路径</label>
              <UiInput v-model="coreForm.icon" placeholder="如 textures/items/diamond" />
            </div>
            <div v-if="actionError" class="text-sm text-destructive">
              {{ actionError }}
            </div>
          </div>
          <div v-else class="py-4">
            <div class="rounded-md bg-muted p-3 text-sm">
              {{ actionResult }}
            </div>
          </div>
          <UiDialogFooter>
            <UiButton variant="outline" @click="coreDialogOpen = false">
              {{ actionResult ? '关闭' : '取消' }}
            </UiButton>
            <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleCoreSubmit">
              {{ actionLoading ? '处理中...' : '确认' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>

      <UiDialog v-model:open="deleteRewardDialogOpen">
        <UiDialogContent class="sm:max-w-[425px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>删除奖励</UiDialogTitle>
            <UiDialogDescription>
              确定要删除该{{ deleteRewardTarget?.type === 'fourStar' ? '四星' : '五星' }}奖励吗？此操作不可撤销。
            </UiDialogDescription>
          </UiDialogHeader>
          <UiDialogFooter>
            <UiButton variant="outline" @click="deleteRewardDialogOpen = false">
              取消
            </UiButton>
            <UiButton variant="destructive" :disabled="deleteRewardLoading" @click="confirmDeleteReward">
              {{ deleteRewardLoading ? '删除中...' : '确认删除' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>

      <UiDialog v-model:open="deleteCoreDialogOpen">
        <UiDialogContent class="sm:max-w-[425px] overflow-hidden">
          <UiDialogHeader>
            <UiDialogTitle>删除兑换物品</UiDialogTitle>
            <UiDialogDescription>
              确定要删除该星核兑换物品吗？此操作不可撤销。
            </UiDialogDescription>
          </UiDialogHeader>
          <UiDialogFooter>
            <UiButton variant="outline" @click="deleteCoreDialogOpen = false">
              取消
            </UiButton>
            <UiButton variant="destructive" :disabled="deleteCoreLoading" @click="confirmDeleteCore">
              {{ deleteCoreLoading ? '删除中...' : '确认删除' }}
            </UiButton>
          </UiDialogFooter>
        </UiDialogContent>
      </UiDialog>
    </div>
  </BasicPage>
</template>
