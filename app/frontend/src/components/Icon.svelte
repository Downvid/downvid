<script lang="ts">
  /**
   * Material Symbols 图标。字体由 app.css 内嵌的 @font-face 提供（离线可用）。
   * 名字写错不会报错，只会渲染成文字，所以只用仓库里已验证过的图标名。
   */
  interface Props {
    name: string
    size?: number
    fill?: boolean
    class?: string
  }
  let { name, size = 20, fill = false, class: className = '' }: Props = $props()
  const style = $derived(
    'font-size:' + size + "px;font-variation-settings:'FILL' " + (fill ? 1 : 0) + ';',
  )
</script>

<span class="msi {className}" style={style} aria-hidden="true">{name}</span>
