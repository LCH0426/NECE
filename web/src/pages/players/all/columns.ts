import type { ColumnDef } from '@tanstack/vue-table'

import { MoreHorizontalIcon } from '@lucide/vue'
import { h } from 'vue'

import type { IPlayer } from '@/services/api/player.api'

import { DataTableColumnHeader } from '@/components/data-table'
import Badge from '@/components/ui/badge/Badge.vue'
import UiButton from '@/components/ui/button/Button.vue'
import UiDropdownMenu from '@/components/ui/dropdown-menu/DropdownMenu.vue'
import UiDropdownMenuContent from '@/components/ui/dropdown-menu/DropdownMenuContent.vue'
import UiDropdownMenuItem from '@/components/ui/dropdown-menu/DropdownMenuItem.vue'
import UiDropdownMenuSeparator from '@/components/ui/dropdown-menu/DropdownMenuSeparator.vue'
import UiDropdownMenuTrigger from '@/components/ui/dropdown-menu/DropdownMenuTrigger.vue'

function formatPlayTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0)
    return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export const columns: ColumnDef<IPlayer>[] = [
  {
    accessorKey: 'uid',
    header: ({ column }) => h(DataTableColumnHeader<IPlayer>, {
      column,
      title: 'UID',
    }),
    cell: ({ row }) => h('div', { class: 'font-mono' }, String(Number(row.getValue('uid'))).padStart(5, '0')),
    enableResizing: true,
  },
  {
    accessorKey: 'name',
    header: () => h('div', { class: 'text-sm font-medium' }, '玩家名'),
    cell: ({ row }) => h('div', { class: 'font-medium' }, row.getValue('name')),
    enableSorting: false,
    enablePinning: false,
    enableResizing: true,
  },
  {
    accessorKey: 'xuid',
    header: () => h('div', { class: 'text-sm font-medium' }, 'XUID'),
    cell: ({ row }) => h('div', { class: 'font-mono text-xs' }, row.getValue('xuid')),
    enableSorting: false,
    enablePinning: false,
    enableResizing: true,
  },
  {
    accessorKey: 'balance',
    header: ({ column }) => h(DataTableColumnHeader<IPlayer>, {
      column,
      title: '余额',
    }),
    cell: ({ row }) => h('div', {}, row.original.balance.toLocaleString()),
    enableResizing: true,
  },
  {
    accessorKey: 'isOnline',
    header: () => h('div', { class: 'text-sm font-medium' }, '在线'),
    cell: ({ row }) => {
      const isOnline = !!row.original.isOnline
      return h(Badge, {
        variant: 'outline',
        class: isOnline ? 'border-green-500 text-green-600' : 'border-gray-300 text-gray-500',
      }, () => isOnline ? '在线' : '离线')
    },
    enableSorting: false,
    enablePinning: false,
    enableResizing: true,
  },
  {
    accessorKey: 'playTime',
    header: ({ column }) => h(DataTableColumnHeader<IPlayer>, {
      column,
      title: '游戏时长',
    }),
    cell: ({ row }) => h('div', {}, formatPlayTime(row.original.playTime)),
    enableResizing: true,
  },
  {
    accessorKey: 'lastIp',
    header: () => h('div', { class: 'text-sm font-medium' }, '上次IP'),
    cell: ({ row }) => h('div', { class: 'font-mono text-xs' }, row.original.lastIp || '-'),
    enableSorting: false,
    enablePinning: false,
    enableResizing: true,
  },
  {
    accessorKey: 'platform',
    header: () => h('div', { class: 'text-sm font-medium' }, '平台'),
    cell: ({ row }) => h('div', {}, row.original.platform || '-'),
    enableSorting: false,
    enablePinning: false,
    enableResizing: true,
  },
  {
    id: 'actions',
    header: () => h('div', {}, '操作'),
    cell: ({ row }) => {
      const openMoneyDialog = inject<(player: IPlayer) => void>('openMoneyDialog')
      const openDetailDialog = inject<(player: IPlayer) => void>('openDetailDialog')
      const openInventoryDialog = inject<(player: IPlayer) => void>('openInventoryDialog')
      const openBanDialog = inject<(player: IPlayer) => void>('openBanDialog')
      const openUnbanDialog = inject<(player: IPlayer) => void>('openUnbanDialog')
      const openTitleDialog = inject<(player: IPlayer) => void>('openTitleDialog')
      const openHeatmapDialog = inject<(player: IPlayer) => void>('openHeatmapDialog')
      const openUidDialog = inject<(player: IPlayer) => void>('openUidDialog')
      const openDeleteDataDialog = inject<(player: IPlayer) => void>('openDeleteDataDialog')
      return h(UiDropdownMenu, {}, {
        default: () => [
          h(UiDropdownMenuTrigger, { asChild: true }, {
            default: () => h(UiButton, { variant: 'ghost', size: 'icon', class: 'h-8 w-8' }, {
              default: () => h(MoreHorizontalIcon, { class: 'size-4' }),
            }),
          }),
          h(UiDropdownMenuContent, { align: 'end' }, {
            default: () => [
              h(UiDropdownMenuItem, { onClick: () => openMoneyDialog?.(row.original) }, { default: () => '经济管理' }),
              h(UiDropdownMenuItem, { onClick: () => openInventoryDialog?.(row.original) }, { default: () => '背包查询' }),
              h(UiDropdownMenuItem, { onClick: () => openTitleDialog?.(row.original) }, { default: () => '称号管理' }),
              h(UiDropdownMenuItem, { onClick: () => openHeatmapDialog?.(row.original) }, { default: () => '热力图' }),
              h(UiDropdownMenuItem, { onClick: () => openUidDialog?.(row.original) }, { default: () => '重新分配UID' }),
              h(UiDropdownMenuSeparator),
              h(UiDropdownMenuItem, { onClick: () => openDetailDialog?.(row.original) }, { default: () => '玩家详情' }),
              row.original.isBanned?.banned
                ? h(UiDropdownMenuItem, { class: 'text-green-600', onClick: () => openUnbanDialog?.(row.original) }, { default: () => '解封' })
                : h(UiDropdownMenuItem, { class: 'text-destructive', onClick: () => openBanDialog?.(row.original) }, { default: () => '封禁' }),
              h(UiDropdownMenuSeparator),
              h(UiDropdownMenuItem, { class: 'text-destructive', onClick: () => openDeleteDataDialog?.(row.original) }, { default: () => '删除数据' }),
            ],
          }),
        ],
      })
    },
    enableSorting: false,
    enablePinning: false,
    enableResizing: false,
  },
]
