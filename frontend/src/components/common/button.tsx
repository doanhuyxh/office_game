import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/utils/cn"
import { Slot } from "radix-ui"
import { Loader2 } from "lucide-react"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    // Nút hành động chính rộng hơn (≥ 96 px, TEST-131); outline / ghost / link / icon / sm / xs giữ nguyên.
    compoundVariants: [
      { variant: ["default", "destructive"], size: "default", class: "min-w-24 px-5 has-[>svg]:px-4" },
      { variant: ["default", "destructive"], size: "lg", class: "min-w-24" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/** Phần tử đầu là icon (lucide / svg), không phải chữ hay thẻ HTML khác. */
function isIcon(node: React.ReactNode): node is React.ReactElement<{ className?: string }> {
  return React.isValidElement(node) && node.type !== React.Fragment && (node.type === "svg" || typeof node.type !== "string")
}

/** Chồng hai lớp vào cùng một ô: `ghost` giữ chỗ (ẩn), `shown` hiện — bề ngang = lớp rộng hơn, không nhảy cỡ. */
function Stack({ ghost, shown }: { ghost: React.ReactNode; shown: React.ReactNode }) {
  const layer = "col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit]"
  return (
    <span className="inline-grid gap-[inherit]">
      <span aria-hidden className={cn(layer, "invisible")}>{ghost}</span>
      <span className={layer}>{shown}</span>
    </span>
  )
}

/**
 * Nút shadcn + trạng thái đang xử lý (TEST-131).
 * - `loading` → disabled + `aria-busy` + `data-loading`, vòng xoay `Loader2` thay icon đầu nút (không có icon thì chèn trước chữ),
 *   mờ nhẹ + con trỏ chờ (không mờ 50% như disabled thường). Đã truyền `loading` (kể cả `false`) thì nút luôn rộng đủ cho cả
 *   hai trạng thái (lớp ẩn giữ chỗ) → bật / tắt loading không nhảy cỡ.
 * - `loadingText` → đổi chữ khi loading (vd "Đang lưu…"); không có thì giữ chữ cũ.
 * - `asChild` + `loading`: chỉ đặt `aria-busy` / `data-loading`, KHÔNG chèn vòng xoay (tránh phá phần tử con).
 *   <Button loading={save.isPending} loadingText="Đang lưu…">Lưu</Button>
 */
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading,
  loadingText,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    loadingText?: React.ReactNode
  }) {
  const Comp = asChild ? Slot.Root : "button"

  // Có prop `loading` (kể cả false) → luôn giữ chỗ cho nội dung lúc loading (lớp ẩn) để bật / tắt không đổi bề ngang.
  let content = children
  if (loading !== undefined && !asChild) {
    const items = React.Children.toArray(children)
    const lead = items.length > 0 && isIcon(items[0]) ? items[0] : null
    const rest = lead ? items.slice(1) : items
    const spinner = <Loader2 aria-hidden className={cn(lead?.props.className, "animate-spin")} />
    if (lead) {
      // Vòng xoay đứng đúng chỗ icon (vẫn là con trực tiếp → padding `has-[>svg]` không đổi).
      const text = loadingText == null || rest.length === 0 ? rest
        : loading ? <Stack ghost={rest} shown={loadingText} /> : <Stack ghost={loadingText} shown={rest} />
      content = <>{loading ? spinner : lead}{text}</>
    } else {
      const busy = <>{spinner}{loadingText ?? items}</>
      content = loading ? <Stack ghost={items} shown={busy} /> : <Stack ghost={busy} shown={items} />
    }
    if (loading) content = <>{content}<span role="status" className="sr-only">Đang xử lý…</span></>
  }

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={asChild ? disabled : disabled || loading}
      className={cn(
        buttonVariants({ variant, size, className }),
        loading && !asChild && "cursor-wait disabled:pointer-events-auto disabled:opacity-80"
      )}
      {...props}
    >
      {content}
    </Comp>
  )
}

export { Button, buttonVariants }
