declare module 'vue-puzzle-vcode' {
  import type { DefineComponent } from 'vue'

  const Vcode: DefineComponent<{
    show: boolean
    canvas?: number
    blockSize?: number
    imgs?: string[]
  }>
  export default Vcode
}
