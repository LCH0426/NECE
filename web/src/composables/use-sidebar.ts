import { Gamepad2Icon, ImageIcon, LayoutDashboardIcon, MessageSquareIcon, PaletteIcon, PictureInPicture2Icon, SettingsIcon, UserIcon, WrenchIcon } from '@lucide/vue'
import { ofetch } from 'ofetch'

import type { NavGroup } from '@/components/app-sidebar/types'

import { API_BASE_URL } from '@/constants/app-config'
import { useAuthStore } from '@/stores/auth'
import { usePluginInfoStore } from '@/stores/plugin-info'

export function useSidebar() {
  const pluginInfoStore = usePluginInfoStore()
  const authStore = useAuthStore()

  if (!pluginInfoStore.type) {
    ofetch<{ code: number, data: { version: string, serverVersion: string, protocol: number, type: 'NEPE' | 'NECE' } }>(`${API_BASE_URL}/version`)
      .then((res) => {
        if (res.code === 200) {
          pluginInfoStore.setPluginInfo(res.data)
        }
      })
      .catch(() => {})
  }

  const settingsNavItems = [
    { title: 'Profile', url: '/settings/', icon: UserIcon },
    { title: 'Account', url: '/settings/account', icon: WrenchIcon },
    { title: 'Appearance', url: '/settings/appearance', icon: PaletteIcon },
    { title: 'Notifications', url: '/settings/notifications', icon: PictureInPicture2Icon },
  ]

  const navData = computed<NavGroup[]>(() => {
    // 非管理员只显示留言板
    if (!authStore.isAdmin) {
      return [
        {
          title: '管理',
          items: [
            { title: '留言板', url: '/messages', icon: MessageSquareIcon },
            { title: '地图画', url: '/players/mapart', icon: ImageIcon },
            { title: '个人信息', url: '/players/profile', icon: UserIcon },
          ],
        },
      ]
    }

    const configItems = [
      ...(pluginInfoStore.isNEPE
        ? [{ title: '祈愿管理', url: '/config/wish' }]
        : []),
      { title: '商店管理', url: '/config/shop' },
      { title: 'CDK管理', url: '/config/cdk' },
      { title: '备份管理', url: '/config/backup' },
      { title: '建筑管理', url: '/config/structure' },
    ]

    return [
      {
        title: '管理',
        items: [
          { title: '总览', url: '/dashboard', icon: LayoutDashboardIcon },
          {
            title: '玩家管理',
            icon: Gamepad2Icon,
            items: [
              { title: '在线玩家', url: '/players/online' },
              { title: '所有玩家', url: '/players/all' },
              { title: '邮件管理', url: '/players/mail' },
              { title: '行为日志', url: '/players/behavior-log' },
              { title: '聊天管理', url: '/players/chat' },
              { title: '操作日志', url: '/players/admin-log' },
              { title: '公会管理', url: '/players/guild' },
              { title: '白名单管理', url: '/players/whitelist' },
              { title: '地图画管理', url: '/players/mapart-manage' },
            ],
          },
          {
            title: '配置管理',
            icon: SettingsIcon,
            items: configItems,
          },
          { title: '留言板', url: '/messages', icon: MessageSquareIcon },
          { title: '地图画', url: '/players/mapart', icon: ImageIcon },
          { title: '个人信息', url: '/players/profile', icon: UserIcon },
        ],
      },
    ]
  })

  const otherPages = ref<NavGroup[]>([])

  return {
    navData,
    otherPages,
    settingsNavItems,
  }
}
