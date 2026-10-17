<script lang="ts">
  /**
   * Material Symbols 图标。
   *
   * 字体族与基础排版由 `style.css` 里内嵌的 @font-face 提供（全局引入，
   * 桌面与容器两个入口共享），这里不重复声明。
   *
   * 图标名由 `pnpm lint:icons` 校验（CI 会跑）。不用字体包的 TS 联合类型做
   * 类型约束：那个集合与真实可渲染集合不一致，会误报（`error_outline`、
   * `system_update`、`new_releases` 都不在联合类型里，但字体能正常渲染）。
   * 字体遇到无效名**不会报错**，只会渲染成空白或图标名文字——历史上
   * `high_definition` 就是这样漏过去的（正确名是 `hd`）。
   */
  interface Props {
    name: string
    size?: number | string
    /** 仅用于兼容调用点；内嵌字体是静态 400 字重，非 400 会被忽略 */
    weight?: number
    fill?: boolean
  }

  let { name, size, fill = false }: Props = $props()

  // Svelte 5 的 $derived 对应 Vue 的 computed。
  // 这里用 $derived.by 因为要构造对象而非单个表达式。
  const style = $derived.by(() => {
    const parts: string[] = []
    if (size !== undefined) {
      parts.push(`font-size:${typeof size === 'number' ? `${size}px` : size}`)
    }
    // 内嵌字体只保留 wght=400，因此不处理 weight；只有 FILL 轴可切换
    if (fill) parts.push(`font-variation-settings:'FILL' 1`)
    return parts.join(';')
  })
</script>

<!-- 内容必须是图标名本身：Material Symbols 靠 liga 连字把文字替换成图形。
     外面包一层 span 而不是直接用 `{name}` 文本，是为了让 style 有落点。 -->
<span class="material-symbols-outlined" style={style}>{name}</span>
