declare module 'vue-sliding-puzzle' {
  import type { DefineComponent } from 'vue'

  const Vcode: DefineComponent<{
    show: boolean
    sliderText?: string
    successText?: string
    interferenceDiagramCount?: number
    width?: number
    height?: number
  }>
  export default Vcode
}

declare module 'vue-sliding-puzzle/css' {
  const css: string
  export default css
}
