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

import type { ICdkItem, ICdkReward } from '@/services/api/cdk.api'
import type { IItemSearchResult } from '@/services/api/recycle.api'

import { BasicPage } from '@/components/global-layout'
import ItemTexture from '@/components/item-texture.vue'
import { useCurrencyName } from '@/composables/use-currency-name'
import { useCdkApi } from '@/services/api/cdk.api'
import { useRecycleApi } from '@/services/api/recycle.api'

const { getCdkList, addCdk, modifyCdk, deleteCdk } = useCdkApi()
const { currencyName, fetchCurrencyName } = useCurrencyName()
const { searchItems } = useRecycleApi()

onMounted(() => {
  fetchCurrencyName()
})

const cdkList = ref<ICdkItem[]>([])
const loading = ref(true)
const searchQuery = ref('')

async function fetchCdkList() {
  loading.value = true
  try {
    const res = await getCdkList()
    if (res.code === 200)
      cdkList.value = res.data
  }
  catch {
    toast.error('获取CDK列表失败')
  }
  finally {
    loading.value = false
  }
}

const filteredList = computed(() => {
  if (!searchQuery.value)
    return cdkList.value
  const q = searchQuery.value.toLowerCase()
  return cdkList.value.filter(item =>
    item.code.toLowerCase().includes(q),
  )
})

function formatRewards(rewards: ICdkReward[]): string {
  return rewards.map((r) => {
    if (r.type === 'money')
      return `${r.amount}${currencyName.value}`
    if (r.type === 'item')
      return `${r.itemName || r.itemId}x${r.count}`
    if (r.type === 'snbt')
      return `${r.itemName || 'SNBT物品'}`
    return '未知'
  }).join(', ')
}

function getRewardTypeLabel(type: string): string {
  if (type === 'money')
    return currencyName.value
  if (type === 'item')
    return '物品'
  if (type === 'snbt')
    return 'SNBT'
  return type
}

onMounted(() => {
  fetchCdkList()
})

const dialogOpen = ref(false)
const dialogMode = ref<'add' | 'edit'>('add')
const actionLoading = ref(false)
const actionError = ref('')
const actionResult = ref('')

const form = reactive({
  code: '',
  maxUses: 0,
  rewards: [{ type: 'money' as const, amount: 0 }] as ICdkReward[],
})

function openAdd() {
  dialogMode.value = 'add'
  form.code = ''
  form.maxUses = 0
  form.rewards = [{ type: 'money', amount: 0 }]
  actionError.value = ''
  actionResult.value = ''
  dialogOpen.value = true
}

function openEdit(item: ICdkItem) {
  dialogMode.value = 'edit'
  form.code = item.code
  form.maxUses = item.maxUses
  form.rewards = item.rewards.length > 0
    ? item.rewards.map(r => ({ ...r }))
    : [{ type: 'money', amount: 0 }]
  actionError.value = ''
  actionResult.value = ''
  dialogOpen.value = true
}

function addReward() {
  form.rewards.push({ type: 'money', amount: 0 })
}

function removeReward(index: number) {
  if (form.rewards.length > 1)
    form.rewards.splice(index, 1)
}

function updateRewardType(index: number, type: string) {
  const current = form.rewards[index]
  if (type === 'money') {
    form.rewards[index] = { type: 'money', amount: current.amount || 0 }
  }
  else if (type === 'item') {
    form.rewards[index] = { type: 'item', itemId: current.itemId || '', itemName: current.itemName || '', count: current.count || 1 }
  }
  else if (type === 'snbt') {
    form.rewards[index] = { type: 'snbt', snbt: current.snbt || '', itemName: current.itemName || '' }
  }
}

const itemSearchResults = ref<IItemSearchResult[]>([])
const itemSearchLoading = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

function handleItemSearch(val: string, _rewardIndex: number) {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  if (!val.trim()) {
    itemSearchResults.value = []
    return
  }
  const keyword = val.trim()
  searchTimer = setTimeout(async () => {
    itemSearchLoading.value = true
    try {
      const res = await searchItems(keyword)
      if (res.code === 200)
        itemSearchResults.value = res.data
      else itemSearchResults.value = []
    }
    catch {
      itemSearchResults.value = []
    }
    finally {
      itemSearchLoading.value = false
    }
  }, 200)
}

function selectSearchItem(rewardIndex: number, item: IItemSearchResult) {
  const reward = form.rewards[rewardIndex]
  if (reward.type === 'item') {
    reward.itemId = item.id.replace('minecraft:', '')
    reward.itemName = item.name
  }
  itemSearchResults.value = []
}

async function handleSubmit() {
  if (!form.code.trim()) {
    actionError.value = '请输入CDK兑换码'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    let res: any
    if (dialogMode.value === 'add') {
      res = await addCdk({
        code: form.code,
        maxUses: form.maxUses,
        rewards: form.rewards,
      })
    }
    else {
      res = await modifyCdk({
        code: form.code,
        maxUses: form.maxUses,
        rewards: form.rewards,
      })
    }
    if (res.code === 200) {
      actionResult.value = dialogMode.value === 'add' ? '添加成功' : '修改成功'
      fetchCdkList()
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

const deleteDialogOpen = ref(false)
const deleteTarget = ref<ICdkItem | null>(null)
const deleteLoading = ref(false)

function openDeleteDialog(item: ICdkItem) {
  deleteTarget.value = item
  deleteDialogOpen.value = true
}

async function handleDelete() {
  if (!deleteTarget.value)
    return
  deleteLoading.value = true
  try {
    const res = await deleteCdk(deleteTarget.value.code)
    if (res.code === 200) {
      toast.success('删除成功')
      fetchCdkList()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleteLoading.value = false
    deleteDialogOpen.value = false
  }
}

const detailDialogOpen = ref(false)
const detailItem = ref<ICdkItem | null>(null)

function generateRandomCdk(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function handleRandomCdk() {
  form.code = generateRandomCdk()
}

function openDetail(item: ICdkItem) {
  detailItem.value = item
  detailDialogOpen.value = true
}
</script>

<template>
  <BasicPage title="CDK管理" description="管理CDK兑换码">
    <div class="flex items-center gap-2 mb-4">
      <UiInput v-model="searchQuery" placeholder="搜索CDK兑换码..." class="max-w-xs" />
      <UiButton variant="outline" size="sm" @click="fetchCdkList">
        刷新
      </UiButton>
      <div class="flex-1" />
      <UiButton size="sm" @click="openAdd">
        <PlusIcon class="size-4 mr-1" />
        添加CDK
      </UiButton>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-12">
      <UiSpinner class="size-6" />
    </div>

    <div v-else class="border rounded-lg">
      <div class="grid grid-cols-[1fr_100px_100px_1fr_80px] gap-4 px-4 py-3 border-b text-xs text-muted-foreground font-medium items-center">
        <span>兑换码</span>
        <span>最大次数</span>
        <span>已使用</span>
        <span>奖励内容</span>
        <span>操作</span>
      </div>
      <div v-if="filteredList.length === 0" class="p-4 text-center text-muted-foreground text-sm">
        暂无CDK兑换码
      </div>
      <div
        v-for="item in filteredList"
        :key="item.code"
        class="grid grid-cols-[1fr_100px_100px_1fr_80px] gap-4 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 items-center cursor-pointer"
        @click="openDetail(item)"
      >
        <span class="text-sm font-mono">{{ item.code }}</span>
        <span class="text-sm text-muted-foreground">{{ item.maxUses === 0 ? '无限' : item.maxUses }}</span>
        <span class="text-sm">{{ item.usedCount }}</span>
        <span class="text-sm text-muted-foreground truncate">{{ formatRewards(item.rewards) }}</span>
        <div class="flex items-center gap-1" @click.stop>
          <UiButton variant="ghost" size="icon" class="size-8" @click="openEdit(item)">
            <PencilIcon class="size-4" />
          </UiButton>
          <UiButton variant="ghost" size="icon" class="size-8 text-destructive" @click="openDeleteDialog(item)">
            <TrashIcon class="size-4" />
          </UiButton>
        </div>
      </div>
    </div>

    <UiDialog v-model:open="dialogOpen">
      <UiDialogContent class="sm:max-w-[550px]">
        <UiDialogHeader>
          <UiDialogTitle>{{ dialogMode === 'add' ? '添加' : '修改' }}CDK</UiDialogTitle>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
          <div class="space-y-2">
            <label class="text-sm font-medium">兑换码 *</label>
            <div class="flex items-center gap-2">
              <UiInput v-model="form.code" placeholder="如 新年快乐2026" :disabled="dialogMode === 'edit'" class="flex-1" />
              <UiButton v-if="dialogMode === 'add'" variant="outline" size="sm" @click="handleRandomCdk">
                随机生成
              </UiButton>
            </div>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">最大使用次数</label>
            <UiInput v-model="form.maxUses" type="number" placeholder="0为无限" :min="0" />
            <span class="text-xs text-muted-foreground">0 表示无限次使用</span>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium">奖励列表</label>
              <UiButton variant="outline" size="sm" @click="addReward">
                <PlusIcon class="size-3 mr-1" />
                添加奖励
              </UiButton>
            </div>
            <div v-for="(reward, idx) in form.rewards" :key="idx" class="border rounded-md p-3 space-y-2">
              <div class="flex items-center gap-2">
                <UiSelect
                  :model-value="reward.type"
                  @update:model-value="(v: any) => updateRewardType(idx, String(v))"
                >
                  <UiSelectTrigger class="w-[100px]">
                    <UiSelectValue />
                  </UiSelectTrigger>
                  <UiSelectContent>
                    <UiSelectItem value="money">
                      {{ currencyName }}
                    </UiSelectItem>
                    <UiSelectItem value="item">
                      物品
                    </UiSelectItem>
                    <UiSelectItem value="snbt">
                      SNBT
                    </UiSelectItem>
                  </UiSelectContent>
                </UiSelect>
                <div class="flex-1" />
                <UiButton
                  v-if="form.rewards.length > 1"
                  variant="ghost"
                  size="icon"
                  class="size-7 text-destructive"
                  @click="removeReward(idx)"
                >
                  <TrashIcon class="size-3" />
                </UiButton>
              </div>

              <template v-if="reward.type === 'money'">
                <UiInput
                  :model-value="reward.amount"
                  type="number"
                  placeholder="金额"
                  :min="0"
                  @update:model-value="(v: any) => reward.amount = Number(v)"
                />
              </template>

              <template v-if="reward.type === 'item'">
                <div class="relative">
                  <UiInput
                    :model-value="reward.itemId"
                    placeholder="搜索物品名称或ID"
                    @update:model-value="(v: string | number) => { reward.itemId = String(v); handleItemSearch(String(v), idx) }"
                  />
                  <div v-if="itemSearchLoading" class="absolute right-3 top-1/2 -translate-y-1/2">
                    <UiSpinner class="size-4" />
                  </div>
                  <div v-if="itemSearchResults.length > 0" class="absolute z-50 w-full mt-1 border rounded-md max-h-24 overflow-y-auto bg-popover shadow-md">
                    <div
                      v-for="sItem in itemSearchResults"
                      :key="sItem.id"
                      class="flex items-center gap-2 px-2 py-1 hover:bg-accent cursor-pointer text-xs border-b last:border-b-0"
                      @click="selectSearchItem(idx, sItem)"
                    >
                      <ItemTexture :texture="sItem.image" :size="16" />
                      <span class="font-medium">{{ sItem.name }}</span>
                      <span class="text-muted-foreground ml-1">{{ sItem.id }}</span>
                    </div>
                  </div>
                </div>
                <UiInput
                  :model-value="reward.count"
                  type="number"
                  placeholder="数量"
                  :min="1"
                  @update:model-value="(v: any) => reward.count = Number(v)"
                />
              </template>

              <template v-if="reward.type === 'snbt'">
                <UiTextarea
                  :model-value="reward.snbt"
                  placeholder="SNBT字符串"
                  rows="2"
                  @update:model-value="(v: string | number) => reward.snbt = String(v)"
                />
                <UiInput
                  :model-value="reward.itemName"
                  placeholder="物品显示名称"
                  @update:model-value="(v: string | number) => reward.itemName = String(v)"
                />
              </template>
            </div>
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
          <UiButton variant="outline" @click="dialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleSubmit">
            {{ actionLoading ? '处理中...' : '确认' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="detailDialogOpen">
      <UiDialogContent class="sm:max-w-[450px]">
        <UiDialogHeader>
          <UiDialogTitle>CDK详情</UiDialogTitle>
        </UiDialogHeader>
        <div v-if="detailItem" class="space-y-3 py-4">
          <div class="flex justify-between">
            <span class="text-sm text-muted-foreground">兑换码</span>
            <span class="text-sm font-mono">{{ detailItem.code }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-sm text-muted-foreground">最大使用次数</span>
            <span class="text-sm">{{ detailItem.maxUses === 0 ? '无限' : detailItem.maxUses }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-sm text-muted-foreground">已使用次数</span>
            <span class="text-sm">{{ detailItem.usedCount }}</span>
          </div>
          <UiSeparator />
          <div>
            <span class="text-sm font-medium">奖励列表</span>
            <div class="mt-2 space-y-2">
              <div
                v-for="(reward, idx) in detailItem.rewards"
                :key="idx"
                class="flex items-center gap-2 rounded-md border p-2"
              >
                <span class="text-xs px-1.5 py-0.5 rounded bg-muted">{{ getRewardTypeLabel(reward.type) }}</span>
                <span class="text-sm">
                  <template v-if="reward.type === 'money'">{{ reward.amount }} {{ currencyName }}</template>
                  <template v-else-if="reward.type === 'item'">{{ reward.itemName || reward.itemId }} x{{ reward.count }}</template>
                  <template v-else-if="reward.type === 'snbt'">{{ reward.itemName || 'SNBT物品' }}</template>
                </span>
              </div>
            </div>
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="detailDialogOpen = false">
            关闭
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="deleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除CDK</UiDialogTitle>
          <UiDialogDescription>
            确定要删除兑换码「{{ deleteTarget?.code }}」吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="deleteLoading" @click="handleDelete">
            {{ deleteLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
