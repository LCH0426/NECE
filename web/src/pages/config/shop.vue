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
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IRecycleItem, IItemSearchResult as IRecycleItemSearchResult } from '@/services/api/recycle.api'
import type { IShopGroup, IShopItem, IItemSearchResult as IShopItemSearchResult } from '@/services/api/shop.api'

import { BasicPage } from '@/components/global-layout'
import ItemTexture from '@/components/item-texture.vue'
import { PAGE_SIZES } from '@/constants/pagination'
import { useRecycleApi } from '@/services/api/recycle.api'
import { useShopApi } from '@/services/api/shop.api'

const activeGroup = ref<'Buy' | 'Sell' | 'Recycle'>('Buy')

const {
  getShopGroups,
  addShopGroup,
  updateShopGroup,
  deleteShopGroup,
  getShopItems,
  addShopItem,
  updateShopItem,
  deleteShopItem,
  searchItems: shopSearchItems,
} = useShopApi()

const {
  getRecycleList,
  addRecycleItem,
  updateRecycleItem,
  deleteRecycleItem,
  searchItems: recycleSearchItems,
} = useRecycleApi()

const groups = ref<IShopGroup[]>([])
const items = ref<IShopItem[]>([])
const selectedGroupIdx = ref<number | null>(null)
const loading = ref(true)
const itemsLoading = ref(false)

const shopSearchQuery = ref('')
const allShopItems = ref<(IShopItem & { groupIdx: number })[]>([])
const globalSearchLoading = ref(false)
let globalSearchTimer: ReturnType<typeof setTimeout> | null = null

async function fetchAllShopItems() {
  globalSearchLoading.value = true
  try {
    const results: (IShopItem & { groupIdx: number })[] = []
    for (const group of groups.value) {
      try {
        const res = await getShopItems(activeGroup.value, group.index)
        if (res.code === 200) {
          for (const item of res.data) {
            results.push({ ...item, groupIdx: group.index })
          }
        }
      }
      catch {}
    }
    allShopItems.value = results
  }
  finally {
    globalSearchLoading.value = false
  }
}

watch(shopSearchQuery, (val) => {
  if (globalSearchTimer) {
    clearTimeout(globalSearchTimer)
    globalSearchTimer = null
  }
  if (val.trim()) {
    globalSearchTimer = setTimeout(() => {
      if (allShopItems.value.length === 0)
        fetchAllShopItems()
    }, 300)
  }
})

const filteredItems = computed(() => {
  if (!shopSearchQuery.value)
    return items.value
  const q = shopSearchQuery.value.toLowerCase()
  if (allShopItems.value.length > 0) {
    return allShopItems.value.filter(item =>
      item.name.toLowerCase().includes(q)
      || item.id.toLowerCase().includes(q),
    )
  }
  return items.value.filter(item =>
    item.name.toLowerCase().includes(q)
    || item.id.toLowerCase().includes(q),
  )
})

const shopSelectedIndices = ref<Set<number>>(new Set())
const shopBatchDeleteDialogOpen = ref(false)
const shopBatchDeleteLoading = ref(false)

const shopIsAllSelected = computed(() => {
  return filteredItems.value.length > 0 && filteredItems.value.every(i => shopSelectedIndices.value.has(i.index))
})
const shopIsIndeterminate = computed(() => {
  const selected = filteredItems.value.filter(i => shopSelectedIndices.value.has(i.index)).length
  return selected > 0 && selected < filteredItems.value.length
})

function shopToggleSelectAll() {
  if (shopIsAllSelected.value) {
    const filteredIds = new Set(filteredItems.value.map(i => i.index))
    const newSet = new Set(shopSelectedIndices.value)
    for (const id of filteredIds)
      newSet.delete(id)
    shopSelectedIndices.value = newSet
  }
  else {
    const newSet = new Set(shopSelectedIndices.value)
    for (const item of filteredItems.value)
      newSet.add(item.index)
    shopSelectedIndices.value = newSet
  }
}

function shopToggleSelect(index: number) {
  const s = new Set(shopSelectedIndices.value)
  if (s.has(index))
    s.delete(index)
  else s.add(index)
  shopSelectedIndices.value = s
}

async function handleShopBatchDelete() {
  if (shopSelectedIndices.value.size === 0)
    return
  shopBatchDeleteDialogOpen.value = true
}

async function confirmShopBatchDelete() {
  if (shopSelectedIndices.value.size === 0 || selectedGroupIdx.value === null)
    return
  shopBatchDeleteLoading.value = true
  let success = 0
  let fail = 0
  for (const itemIdx of shopSelectedIndices.value) {
    try {
      const res = await deleteShopItem(itemIdx, activeGroup.value, selectedGroupIdx.value)
      if (res.code === 200)
        success++
      else fail++
    }
    catch {
      fail++
    }
  }
  shopBatchDeleteLoading.value = false
  shopSelectedIndices.value = new Set()
  shopBatchDeleteDialogOpen.value = false
  if (fail === 0)
    toast.success(`批量删除成功 (${success}个)`)
  else toast.warning(`删除完成：成功${success}个，失败${fail}个`)
  fetchItems()
}

const itemSearchText = ref('')
const itemSearchResults = ref<IShopItemSearchResult[]>([])
const searchLoading = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null
const selectedItem = ref<{ id: string, name: string, image: string } | null>(null)

async function handleItemSearch(val: string) {
  itemSearchText.value = val
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
    searchLoading.value = true
    try {
      const res = await shopSearchItems(keyword)
      if (res.code === 200)
        itemSearchResults.value = res.data
      else itemSearchResults.value = []
    }
    catch {
      itemSearchResults.value = []
    }
    finally {
      searchLoading.value = false
    }
  }, 200)
}

function selectSearchItem(item: IShopItemSearchResult) {
  selectedItem.value = { id: item.id.replace('minecraft:', ''), name: item.name, image: item.image }
  itemSearchText.value = ''
  itemSearchResults.value = []
}

function clearSelectedItem() {
  selectedItem.value = null
  itemSearchText.value = ''
  itemSearchResults.value = []
}

async function fetchGroups() {
  loading.value = true
  try {
    const res = await getShopGroups(activeGroup.value)
    if (res.code === 200) {
      groups.value = res.data
      if (res.data.length > 0 && selectedGroupIdx.value === null)
        selectedGroupIdx.value = res.data[0].index
      if (selectedGroupIdx.value !== null)
        await fetchItems()
    }
  }
  catch {
    toast.error('获取商店分组失败')
  }
  finally {
    loading.value = false
  }
}

async function fetchItems() {
  if (selectedGroupIdx.value === null) {
    items.value = []
    return
  }
  itemsLoading.value = true
  try {
    const res = await getShopItems(activeGroup.value, selectedGroupIdx.value)
    if (res.code === 200)
      items.value = res.data
  }
  catch {
    toast.error('获取商店物品失败')
  }
  finally {
    itemsLoading.value = false
  }
}

watch(activeGroup, (val) => {
  shopSearchQuery.value = ''
  allShopItems.value = []
  if (val === 'Recycle') {
    fetchRecycleItems()
  }
  else {
    selectedGroupIdx.value = null
    items.value = []
    fetchGroups()
  }
})

onMounted(() => {
  fetchGroups()
})

watch(selectedGroupIdx, () => {
  fetchItems()
})

const groupDialogOpen = ref(false)
const groupMode = ref<'add' | 'edit'>('add')
const groupEditIdx = ref(-1)
const groupForm = reactive({ name: '', image: '' })
const actionLoading = ref(false)
const actionError = ref('')
const actionResult = ref('')

function openAddGroup() {
  groupMode.value = 'add'
  groupForm.name = ''
  groupForm.image = ''
  actionError.value = ''
  actionResult.value = ''
  groupDialogOpen.value = true
}

function openEditGroup(group: IShopGroup) {
  groupMode.value = 'edit'
  groupEditIdx.value = group.index
  groupForm.name = group.name
  groupForm.image = group.image
  actionError.value = ''
  actionResult.value = ''
  groupDialogOpen.value = true
}

async function handleGroupSubmit() {
  actionLoading.value = true
  actionError.value = ''
  try {
    let res: any
    if (groupMode.value === 'add') {
      const data: { group: string, name: string, image?: string } = { group: activeGroup.value, name: groupForm.name }
      if (groupForm.image)
        data.image = groupForm.image
      res = await addShopGroup(data)
    }
    else {
      const data: { group: string, name?: string, image?: string } = { group: activeGroup.value }
      const original = groups.value.find(g => g.index === groupEditIdx.value)
      if (original) {
        if (groupForm.name !== original.name)
          data.name = groupForm.name
        if (groupForm.image !== original.image)
          data.image = groupForm.image
      }
      res = await updateShopGroup(groupEditIdx.value, data)
    }
    if (res.code === 200) {
      actionResult.value = groupMode.value === 'add' ? '添加成功' : '修改成功'
      fetchGroups()
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

const deleteGroupDialogOpen = ref(false)
const deleteGroupTarget = ref<IShopGroup | null>(null)
const deleteGroupLoading = ref(false)

const deleteItemDialogOpen = ref(false)
const deleteItemTarget = ref<IShopItem | null>(null)
const deleteItemLoading = ref(false)

async function handleDeleteGroup(group: IShopGroup) {
  deleteGroupTarget.value = group
  deleteGroupDialogOpen.value = true
}

async function confirmDeleteGroup() {
  if (!deleteGroupTarget.value)
    return
  deleteGroupLoading.value = true
  try {
    const res = await deleteShopGroup(deleteGroupTarget.value.index, activeGroup.value)
    if (res.code === 200) {
      toast.success('删除成功')
      selectedGroupIdx.value = null
      fetchGroups()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleteGroupLoading.value = false
    deleteGroupDialogOpen.value = false
  }
}

const itemDialogOpen = ref(false)
const itemMode = ref<'add' | 'edit'>('add')
const itemEditIdx = ref(-1)
const itemMoney = ref(0)

function openAddItem() {
  itemMode.value = 'add'
  selectedItem.value = null
  itemMoney.value = 0
  itemSearchText.value = ''
  itemSearchResults.value = []
  actionError.value = ''
  actionResult.value = ''
  itemDialogOpen.value = true
}

function openEditItem(item: IShopItem) {
  itemMode.value = 'edit'
  itemEditIdx.value = item.index
  selectedItem.value = { id: item.id.replace('minecraft:', ''), name: item.name, image: item.image }
  itemMoney.value = item.money
  itemSearchText.value = ''
  itemSearchResults.value = []
  actionError.value = ''
  actionResult.value = ''
  itemDialogOpen.value = true
}

async function handleItemSubmit() {
  if (selectedGroupIdx.value === null)
    return
  if (itemMode.value === 'add' && !selectedItem.value) {
    actionError.value = '请选择一个物品'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    let res: any
    if (itemMode.value === 'add') {
      res = await addShopItem({
        group: activeGroup.value,
        groupIdx: selectedGroupIdx.value,
        id: selectedItem.value!.id,
        money: itemMoney.value,
      })
    }
    else {
      const data: { group: string, groupIdx: number, id?: string, money?: number, image?: string } = {
        group: activeGroup.value,
        groupIdx: selectedGroupIdx.value!,
      }
      const original = items.value.find(i => i.index === itemEditIdx.value)
      if (original) {
        const rawId = original.id.replace('minecraft:', '')
        if (selectedItem.value && selectedItem.value.id !== rawId)
          data.id = selectedItem.value.id
        if (itemMoney.value !== original.money)
          data.money = itemMoney.value
      }
      res = await updateShopItem(itemEditIdx.value, data)
    }
    if (res.code === 200) {
      actionResult.value = itemMode.value === 'add' ? '添加成功' : '修改成功'
      fetchItems()
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

async function handleDeleteItem(item: IShopItem) {
  if (selectedGroupIdx.value === null)
    return
  deleteItemTarget.value = item
  deleteItemDialogOpen.value = true
}

async function confirmDeleteItem() {
  if (!deleteItemTarget.value || selectedGroupIdx.value === null)
    return
  deleteItemLoading.value = true
  try {
    const res = await deleteShopItem(deleteItemTarget.value.index, activeGroup.value, selectedGroupIdx.value)
    if (res.code === 200) {
      toast.success('删除成功')
      fetchItems()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleteItemLoading.value = false
    deleteItemDialogOpen.value = false
  }
}

// --- Recycle (一键回收) ---
const recycleItems = ref<IRecycleItem[]>([])
const recycleLoading = ref(true)
const recycleSearchQuery = ref('')
const recycleCurrentPage = ref(1)
const recyclePageSize = ref(20)

const recycleFilteredItems = computed(() => {
  if (!recycleSearchQuery.value)
    return recycleItems.value
  const q = recycleSearchQuery.value.toLowerCase()
  return recycleItems.value.filter(item =>
    item.id.toLowerCase().includes(q)
    || item.name.toLowerCase().includes(q),
  )
})

const recycleTotalFiltered = computed(() => recycleFilteredItems.value.length)
const recycleTotalPages = computed(() => Math.ceil(recycleTotalFiltered.value / recyclePageSize.value) || 1)

const recyclePagedItems = computed(() => {
  const start = (recycleCurrentPage.value - 1) * recyclePageSize.value
  return recycleFilteredItems.value.slice(start, start + recyclePageSize.value)
})

watch(recycleSearchQuery, () => {
  recycleCurrentPage.value = 1
})

function handleRecyclePageSizeChange(val: any) {
  recyclePageSize.value = Number(val)
  recycleCurrentPage.value = 1
}

const recycleSelectedIds = ref<Set<string>>(new Set())
const recycleBatchDeleting = ref(false)

const recycleIsAllSelected = computed(() => recycleFilteredItems.value.length > 0 && recycleFilteredItems.value.every(i => recycleSelectedIds.value.has(i.id)))
const recycleIsIndeterminate = computed(() => {
  const selectedInView = recycleFilteredItems.value.filter(i => recycleSelectedIds.value.has(i.id)).length
  return selectedInView > 0 && selectedInView < recycleFilteredItems.value.length
})

function recycleToggleSelectAll() {
  if (recycleIsAllSelected.value) {
    const filteredIds = new Set(recycleFilteredItems.value.map(i => i.id))
    const newSet = new Set(recycleSelectedIds.value)
    for (const id of filteredIds)
      newSet.delete(id)
    recycleSelectedIds.value = newSet
  }
  else {
    const newSet = new Set(recycleSelectedIds.value)
    for (const item of recycleFilteredItems.value)
      newSet.add(item.id)
    recycleSelectedIds.value = newSet
  }
}

function recycleToggleSelect(id: string) {
  const s = new Set(recycleSelectedIds.value)
  if (s.has(id))
    s.delete(id)
  else s.add(id)
  recycleSelectedIds.value = s
}

const recycleBatchDeleteDialogOpen = ref(false)
const recycleDeleteDialogOpen = ref(false)
const recycleDeleteTarget = ref<IRecycleItem | null>(null)
const recycleDeleteLoading = ref(false)

async function handleRecycleBatchDelete() {
  if (recycleSelectedIds.value.size === 0)
    return
  recycleBatchDeleteDialogOpen.value = true
}

async function confirmRecycleBatchDelete() {
  if (recycleSelectedIds.value.size === 0)
    return
  recycleBatchDeleting.value = true
  let success = 0
  let fail = 0
  for (const id of recycleSelectedIds.value) {
    try {
      const res = await deleteRecycleItem(id)
      if (res.code === 200)
        success++
      else fail++
    }
    catch {
      fail++
    }
  }
  recycleBatchDeleting.value = false
  recycleSelectedIds.value = new Set()
  recycleBatchDeleteDialogOpen.value = false
  if (fail === 0)
    toast.success(`批量删除成功 (${success}个)`)
  else toast.warning(`删除完成：成功${success}个，失败${fail}个`)
  fetchRecycleItems()
}

async function fetchRecycleItems() {
  recycleLoading.value = true
  try {
    const res = await getRecycleList()
    if (res.code === 200)
      recycleItems.value = res.data
  }
  catch {
    toast.error('获取回收物品列表失败')
  }
  finally {
    recycleLoading.value = false
  }
}

const recycleItemSearchResults = ref<IRecycleItemSearchResult[]>([])
const recycleSearchLoading = ref(false)
let recycleSearchTimer: ReturnType<typeof setTimeout> | null = null

async function handleRecycleItemSearch(val: string) {
  if (recycleSearchTimer) {
    clearTimeout(recycleSearchTimer)
    recycleSearchTimer = null
  }
  if (!val.trim()) {
    recycleItemSearchResults.value = []
    return
  }
  const keyword = val.trim()
  recycleSearchTimer = setTimeout(async () => {
    recycleSearchLoading.value = true
    try {
      const res = await recycleSearchItems(keyword)
      if (res.code === 200)
        recycleItemSearchResults.value = res.data
      else recycleItemSearchResults.value = []
    }
    catch {
      recycleItemSearchResults.value = []
    }
    finally {
      recycleSearchLoading.value = false
    }
  }, 200)
}

const recycleDialogOpen = ref(false)
const recycleDialogMode = ref<'add' | 'edit'>('add')
const recycleEditId = ref('')
const recycleActionLoading = ref(false)
const recycleActionError = ref('')
const recycleActionResult = ref('')

const recycleAddSearchText = ref('')
const recycleSelectedItem = ref<{ id: string, name: string, image: string } | null>(null)
const recycleEditPrice = ref(0)

function openRecycleAdd() {
  recycleDialogMode.value = 'add'
  recycleAddSearchText.value = ''
  recycleSelectedItem.value = null
  recycleEditPrice.value = 0
  recycleItemSearchResults.value = []
  recycleActionError.value = ''
  recycleActionResult.value = ''
  recycleDialogOpen.value = true
}

function openRecycleEdit(item: IRecycleItem) {
  recycleDialogMode.value = 'edit'
  recycleEditId.value = item.id
  recycleSelectedItem.value = { id: item.id.replace('minecraft:', ''), name: item.name, image: item.image }
  recycleEditPrice.value = item.price
  recycleItemSearchResults.value = []
  recycleActionError.value = ''
  recycleActionResult.value = ''
  recycleDialogOpen.value = true
}

function selectRecycleSearchItem(item: IRecycleItemSearchResult) {
  recycleSelectedItem.value = { id: item.id.replace('minecraft:', ''), name: item.name, image: item.image }
  recycleAddSearchText.value = ''
  recycleItemSearchResults.value = []
}

function clearRecycleSelectedItem() {
  recycleSelectedItem.value = null
  recycleAddSearchText.value = ''
  recycleItemSearchResults.value = []
}

async function handleRecycleSubmit() {
  if (recycleDialogMode.value === 'add' && !recycleSelectedItem.value) {
    recycleActionError.value = '请选择一个物品'
    return
  }
  recycleActionLoading.value = true
  recycleActionError.value = ''
  try {
    let res: any
    if (recycleDialogMode.value === 'add') {
      res = await addRecycleItem({ id: recycleSelectedItem.value!.id, price: recycleEditPrice.value })
    }
    else {
      res = await updateRecycleItem(recycleEditId.value, recycleEditPrice.value)
    }
    if (res.code === 200) {
      recycleActionResult.value = recycleDialogMode.value === 'add' ? '添加成功' : '修改成功'
      fetchRecycleItems()
    }
    else {
      recycleActionError.value = res.msg || '操作失败'
    }
  }
  catch {
    recycleActionError.value = '操作失败'
  }
  finally {
    recycleActionLoading.value = false
  }
}

async function handleRecycleDelete(item: IRecycleItem) {
  recycleDeleteTarget.value = item
  recycleDeleteDialogOpen.value = true
}

async function confirmRecycleDelete() {
  if (!recycleDeleteTarget.value)
    return
  recycleDeleteLoading.value = true
  try {
    const res = await deleteRecycleItem(recycleDeleteTarget.value.id)
    if (res.code === 200) {
      toast.success('删除成功')
      fetchRecycleItems()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    recycleDeleteLoading.value = false
    recycleDeleteDialogOpen.value = false
  }
}
</script>

<template>
  <BasicPage title="商店管理" description="管理商店分组、物品数据和快捷回收">
    <div class="flex items-center gap-2 mb-4">
      <UiTabs v-model="activeGroup" class="w-auto">
        <UiTabsList>
          <UiTabsTrigger value="Buy">
            购买商店
          </UiTabsTrigger>
          <UiTabsTrigger value="Sell">
            出售商店
          </UiTabsTrigger>
          <UiTabsTrigger value="Recycle">
            快捷回收
          </UiTabsTrigger>
        </UiTabsList>
      </UiTabs>
      <template v-if="activeGroup !== 'Recycle'">
        <UiInput v-model="shopSearchQuery" placeholder="搜索物品..." class="max-w-[200px]" />
        <div class="flex-1" />
        <UiButton variant="outline" size="sm" @click="fetchGroups">
          刷新
        </UiButton>
      </template>
      <template v-else>
        <UiInput v-model="recycleSearchQuery" placeholder="搜索物品ID或名称..." class="max-w-[200px]" />
        <div class="flex-1" />
        <UiButton variant="outline" size="sm" @click="fetchRecycleItems">
          刷新
        </UiButton>
        <UiButton
          v-if="recycleSelectedIds.size > 0"
          variant="destructive"
          size="sm"
          :disabled="recycleBatchDeleting"
          @click="handleRecycleBatchDelete"
        >
          <TrashIcon class="size-4 mr-1" />
          批量删除 ({{ recycleSelectedIds.size }})
        </UiButton>
        <UiButton size="sm" @click="openRecycleAdd">
          <PlusIcon class="size-4 mr-1" />
          添加回收物品
        </UiButton>
      </template>
    </div>

    <!-- 购买/出售商店 -->
    <template v-if="activeGroup !== 'Recycle'">
      <div v-if="loading" class="flex items-center justify-center py-12">
        <UiSpinner class="size-6" />
      </div>

      <div v-else class="grid grid-cols-[260px_1fr] gap-4">
        <div class="border rounded-lg">
          <div class="flex items-center justify-between p-3 border-b">
            <h3 class="text-sm font-medium">
              分组列表
            </h3>
            <UiButton variant="ghost" size="icon" class="size-7" @click="openAddGroup">
              <PlusIcon class="size-4" />
            </UiButton>
          </div>
          <div v-if="groups.length === 0" class="p-3 text-center text-muted-foreground text-sm">
            暂无分组
          </div>
          <div
            v-for="group in groups"
            :key="group.index"
            class="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 cursor-pointer hover:bg-muted/30"
            :class="{ 'bg-muted/50': selectedGroupIdx === group.index }"
            @click="selectedGroupIdx = group.index"
          >
            <ItemTexture :texture="group.image" :size="20" />
            <span class="flex-1 text-sm truncate">{{ group.name }}</span>
            <span class="text-xs text-muted-foreground">{{ group.itemCount }}件</span>
            <UiButton variant="ghost" size="icon" class="size-6 shrink-0" @click.stop="openEditGroup(group)">
              <PencilIcon class="size-3" />
            </UiButton>
            <UiButton variant="ghost" size="icon" class="size-6 shrink-0 text-destructive" @click.stop="handleDeleteGroup(group)">
              <TrashIcon class="size-3" />
            </UiButton>
          </div>
        </div>

        <div class="border rounded-lg">
          <div class="flex items-center justify-between p-3 border-b">
            <h3 class="text-sm font-medium">
              物品列表
              <span v-if="selectedGroupIdx !== null" class="text-muted-foreground">({{ filteredItems.length }})</span>
            </h3>
            <div class="flex items-center gap-2">
              <UiButton
                v-if="shopSelectedIndices.size > 0"
                variant="destructive"
                size="sm"
                :disabled="shopBatchDeleteLoading"
                @click="handleShopBatchDelete"
              >
                <TrashIcon class="size-4 mr-1" />
                批量删除 ({{ shopSelectedIndices.size }})
              </UiButton>
              <UiButton v-if="selectedGroupIdx !== null" size="sm" @click="openAddItem">
                <PlusIcon class="size-4 mr-1" />
                添加物品
              </UiButton>
            </div>
          </div>
          <div v-if="selectedGroupIdx === null" class="p-6 text-center text-muted-foreground text-sm">
            请在左侧选择一个分组
          </div>
          <div v-else-if="itemsLoading" class="flex items-center justify-center py-8">
            <UiSpinner class="size-5" />
          </div>
          <div v-else-if="filteredItems.length === 0" class="p-6 text-center text-muted-foreground text-sm">
            {{ shopSearchQuery ? '未找到匹配物品' : '该分组暂无物品' }}
          </div>
          <div v-else>
            <div class="grid grid-cols-[40px_32px_1fr_1fr_100px_80px] gap-3 px-3 py-2 border-b text-xs text-muted-foreground font-medium items-center">
              <UiCheckbox
                :model-value="shopIsAllSelected || (shopIsIndeterminate ? 'indeterminate' : false)"
                @update:model-value="shopToggleSelectAll"
              />
              <span />
              <span>物品名称</span>
              <span>物品ID</span>
              <span>价格</span>
              <span>操作</span>
            </div>
            <div
              v-for="item in filteredItems"
              :key="item.index"
              class="grid grid-cols-[40px_32px_1fr_1fr_100px_80px] gap-3 px-3 py-2 border-b last:border-b-0 hover:bg-muted/30 items-center"
            >
              <UiCheckbox
                :model-value="shopSelectedIndices.has(item.index)"
                @update:model-value="shopToggleSelect(item.index)"
              />
              <ItemTexture :texture="item.image" :size="24" />
              <span class="text-sm truncate">{{ item.name }}</span>
              <span class="text-xs font-mono text-muted-foreground truncate">{{ item.id }}</span>
              <span class="text-sm font-mono text-primary">{{ item.money }}</span>
              <div class="flex items-center gap-1">
                <UiButton variant="ghost" size="icon" class="size-7" @click="openEditItem(item)">
                  <PencilIcon class="size-3.5" />
                </UiButton>
                <UiButton variant="ghost" size="icon" class="size-7 text-destructive" @click="handleDeleteItem(item)">
                  <TrashIcon class="size-3.5" />
                </UiButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 快捷回收 -->
    <template v-if="activeGroup === 'Recycle'">
      <div v-if="recycleLoading" class="flex items-center justify-center py-12">
        <UiSpinner class="size-6" />
      </div>

      <div v-else>
        <div class="border rounded-lg">
          <div class="grid grid-cols-[40px_32px_1fr_1fr_120px_80px] gap-4 px-4 py-3 border-b text-xs text-muted-foreground font-medium items-center">
            <UiCheckbox
              :model-value="recycleIsAllSelected || (recycleIsIndeterminate ? 'indeterminate' : false)"
              @update:model-value="recycleToggleSelectAll"
            />
            <span />
            <span>中文名称</span>
            <span>物品ID</span>
            <span>回收价格</span>
            <span>操作</span>
          </div>
          <div v-if="recyclePagedItems.length === 0" class="p-4 text-center text-muted-foreground text-sm">
            暂无回收物品
          </div>
          <div
            v-for="item in recyclePagedItems"
            :key="item.id"
            class="grid grid-cols-[40px_32px_1fr_1fr_120px_80px] gap-4 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 items-center"
          >
            <UiCheckbox
              :model-value="recycleSelectedIds.has(item.id)"
              @update:model-value="recycleToggleSelect(item.id)"
            />
            <ItemTexture :texture="item.image" :size="24" />
            <span class="text-sm">{{ item.name }}</span>
            <span class="text-sm font-mono text-muted-foreground">{{ item.id }}</span>
            <span class="text-sm font-mono text-primary">{{ item.price }}</span>
            <div class="flex items-center gap-1">
              <UiButton variant="ghost" size="icon" class="size-8" @click="openRecycleEdit(item)">
                <PencilIcon class="size-4" />
              </UiButton>
              <UiButton variant="ghost" size="icon" class="size-8 text-destructive" @click="handleRecycleDelete(item)">
                <TrashIcon class="size-4" />
              </UiButton>
            </div>
          </div>
        </div>

        <div v-if="recycleTotalFiltered > 0" class="flex items-center justify-between px-2 py-3">
          <div class="text-sm text-muted-foreground">
            共 {{ recycleTotalFiltered }} 项，已选 {{ recycleSelectedIds.size }} 项
          </div>
          <div class="flex items-center space-x-6 lg:space-x-8">
            <div class="flex items-center space-x-2">
              <p class="hidden text-sm font-medium md:block">
                每页行数
              </p>
              <UiSelect
                :model-value="`${recyclePageSize}`"
                @update:model-value="handleRecyclePageSizeChange"
              >
                <UiSelectTrigger class="h-8 w-[70px]">
                  <UiSelectValue :placeholder="`${recyclePageSize}`" />
                </UiSelectTrigger>
                <UiSelectContent side="top">
                  <UiSelectItem v-for="size in PAGE_SIZES" :key="size" :value="`${size}`">
                    {{ size }}
                  </UiSelectItem>
                </UiSelectContent>
              </UiSelect>
            </div>
            <div class="flex w-[100px] items-center justify-center text-sm font-medium">
              第 {{ recycleCurrentPage }} / {{ recycleTotalPages }} 页
            </div>
            <div class="flex items-center space-x-2">
              <UiButton
                variant="outline"
                class="hidden size-8 p-0 lg:flex"
                :disabled="recycleCurrentPage <= 1"
                @click="recycleCurrentPage = 1"
              >
                <span class="sr-only">第一页</span>
                <ChevronsLeftIcon class="size-4" />
              </UiButton>
              <UiButton
                variant="outline"
                class="size-8 p-0"
                :disabled="recycleCurrentPage <= 1"
                @click="recycleCurrentPage--"
              >
                <span class="sr-only">上一页</span>
                <ChevronLeftIcon class="size-4" />
              </UiButton>
              <UiButton
                variant="outline"
                class="size-8 p-0"
                :disabled="recycleCurrentPage >= recycleTotalPages"
                @click="recycleCurrentPage++"
              >
                <span class="sr-only">下一页</span>
                <ChevronRightIcon class="size-4" />
              </UiButton>
              <UiButton
                variant="outline"
                class="hidden size-8 p-0 lg:flex"
                :disabled="recycleCurrentPage >= recycleTotalPages"
                @click="recycleCurrentPage = recycleTotalPages"
              >
                <span class="sr-only">最后一页</span>
                <ChevronsRightIcon class="size-4" />
              </UiButton>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 商店分组 Dialog -->
    <UiDialog v-model:open="groupDialogOpen">
      <UiDialogContent class="sm:max-w-[450px]">
        <UiDialogHeader>
          <UiDialogTitle>{{ groupMode === 'add' ? '添加' : '修改' }}商店分组</UiDialogTitle>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">分组名称 *</label>
            <UiInput v-model="groupForm.name" placeholder="如 §l§6食物类Food" />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">图标纹理路径</label>
            <div class="flex items-center gap-2">
              <UiInput v-model="groupForm.image" placeholder="如 textures/items/bread.png" class="flex-1" />
              <ItemTexture :texture="groupForm.image" :size="32" />
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
          <UiButton variant="outline" @click="groupDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleGroupSubmit">
            {{ actionLoading ? '处理中...' : '确认' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 商店物品 Dialog -->
    <UiDialog v-model:open="itemDialogOpen">
      <UiDialogContent class="sm:max-w-[450px]">
        <UiDialogHeader>
          <UiDialogTitle>{{ itemMode === 'add' ? '添加' : '修改' }}商店物品</UiDialogTitle>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">物品 *</label>
            <template v-if="itemMode === 'add'">
              <div v-if="!selectedItem" class="relative">
                <UiInput
                  :model-value="itemSearchText"
                  placeholder="输入物品名称或ID搜索..."
                  @update:model-value="(v: string | number) => handleItemSearch(String(v))"
                />
                <div v-if="searchLoading" class="absolute right-3 top-1/2 -translate-y-1/2">
                  <UiSpinner class="size-4" />
                </div>
                <div v-if="itemSearchResults.length > 0" class="absolute z-50 w-full mt-1 border rounded-md max-h-48 overflow-y-auto bg-popover shadow-md">
                  <div
                    v-for="sItem in itemSearchResults"
                    :key="sItem.id"
                    class="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm border-b last:border-b-0"
                    @click="selectSearchItem(sItem)"
                  >
                    <ItemTexture :texture="sItem.image" :size="20" />
                    <span class="font-medium">{{ sItem.name }}</span>
                    <span class="text-muted-foreground text-xs ml-auto">{{ sItem.id }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/50">
                <ItemTexture :texture="selectedItem.image" :size="24" />
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-medium">{{ selectedItem.name }}</span>
                  <span class="text-xs text-muted-foreground font-mono ml-2">{{ selectedItem.id }}</span>
                </div>
                <UiButton variant="ghost" size="icon" class="size-6 shrink-0" @click="clearSelectedItem">
                  <XIcon class="size-3.5" />
                </UiButton>
              </div>
            </template>
            <div v-else class="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/50">
              <ItemTexture :texture="selectedItem!.image" :size="24" />
              <div class="flex-1 min-w-0">
                <span class="text-sm font-medium">{{ selectedItem!.name }}</span>
                <span class="text-xs text-muted-foreground font-mono ml-2">{{ selectedItem!.id }}</span>
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">价格 *</label>
            <UiInput v-model="itemMoney" type="number" placeholder="0" :min="0" />
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
          <UiButton variant="outline" @click="itemDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleItemSubmit">
            {{ actionLoading ? '处理中...' : '确认' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 删除商店分组 Dialog -->
    <UiDialog v-model:open="deleteGroupDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除分组</UiDialogTitle>
          <UiDialogDescription>
            确定要删除分组「{{ deleteGroupTarget?.name }}」吗？该分组下的所有物品也将被删除，此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteGroupDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="deleteGroupLoading" @click="confirmDeleteGroup">
            {{ deleteGroupLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 批量删除商店物品 Dialog -->
    <UiDialog v-model:open="shopBatchDeleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>批量删除物品</UiDialogTitle>
          <UiDialogDescription>
            确定要删除选中的 {{ shopSelectedIndices.size }} 个物品吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="shopBatchDeleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="shopBatchDeleteLoading" @click="confirmShopBatchDelete">
            {{ shopBatchDeleteLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 删除商店物品 Dialog -->
    <UiDialog v-model:open="deleteItemDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除物品</UiDialogTitle>
          <UiDialogDescription>
            确定要删除物品「{{ deleteItemTarget?.name }}」吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteItemDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="deleteItemLoading" @click="confirmDeleteItem">
            {{ deleteItemLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 回收物品添加/编辑 Dialog -->
    <UiDialog v-model:open="recycleDialogOpen">
      <UiDialogContent class="sm:max-w-[450px]">
        <UiDialogHeader>
          <UiDialogTitle>{{ recycleDialogMode === 'add' ? '添加' : '修改' }}回收物品</UiDialogTitle>
        </UiDialogHeader>
        <div v-if="!recycleActionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">物品 *</label>
            <template v-if="recycleDialogMode === 'add'">
              <div v-if="!recycleSelectedItem" class="relative">
                <UiInput
                  :model-value="recycleAddSearchText"
                  placeholder="输入物品名称或ID搜索..."
                  @update:model-value="(v: string | number) => { recycleAddSearchText = String(v); handleRecycleItemSearch(String(v)) }"
                />
                <div v-if="recycleSearchLoading" class="absolute right-3 top-1/2 -translate-y-1/2">
                  <UiSpinner class="size-4" />
                </div>
                <div v-if="recycleItemSearchResults.length > 0" class="absolute z-50 w-full mt-1 border rounded-md max-h-48 overflow-y-auto bg-popover shadow-md">
                  <div
                    v-for="sItem in recycleItemSearchResults"
                    :key="sItem.id"
                    class="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm border-b last:border-b-0"
                    @click="selectRecycleSearchItem(sItem)"
                  >
                    <ItemTexture :texture="sItem.image" :size="20" />
                    <span class="font-medium">{{ sItem.name }}</span>
                    <span class="text-muted-foreground text-xs ml-auto">{{ sItem.id }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/50">
                <ItemTexture :texture="recycleSelectedItem.image" :size="24" />
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-medium">{{ recycleSelectedItem.name }}</span>
                  <span class="text-xs text-muted-foreground font-mono ml-2">{{ recycleSelectedItem.id }}</span>
                </div>
                <UiButton variant="ghost" size="icon" class="size-6 shrink-0" @click="clearRecycleSelectedItem">
                  <XIcon class="size-3.5" />
                </UiButton>
              </div>
            </template>
            <div v-else class="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/50">
              <ItemTexture :texture="recycleSelectedItem!.image" :size="24" />
              <div class="flex-1 min-w-0">
                <span class="text-sm font-medium">{{ recycleSelectedItem!.name }}</span>
                <span class="text-xs text-muted-foreground font-mono ml-2">{{ recycleSelectedItem!.id }}</span>
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">回收价格 *</label>
            <UiInput v-model="recycleEditPrice" type="number" placeholder="0" :min="0" />
          </div>
          <div v-if="recycleActionError" class="text-sm text-destructive">
            {{ recycleActionError }}
          </div>
        </div>
        <div v-else class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ recycleActionResult }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="recycleDialogOpen = false">
            {{ recycleActionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!recycleActionResult" :disabled="recycleActionLoading" @click="handleRecycleSubmit">
            {{ recycleActionLoading ? '处理中...' : '确认' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 删除回收物品 Dialog -->
    <UiDialog v-model:open="recycleDeleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除回收物品</UiDialogTitle>
          <UiDialogDescription>
            确定要删除「{{ recycleDeleteTarget?.name }}」({{ recycleDeleteTarget?.id }}) 吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="recycleDeleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="recycleDeleteLoading" @click="confirmRecycleDelete">
            {{ recycleDeleteLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 批量删除回收物品 Dialog -->
    <UiDialog v-model:open="recycleBatchDeleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>批量删除</UiDialogTitle>
          <UiDialogDescription>
            确定要删除选中的 {{ recycleSelectedIds.size }} 个回收物品吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="recycleBatchDeleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="recycleBatchDeleting" @click="confirmRecycleBatchDelete">
            {{ recycleBatchDeleting ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
