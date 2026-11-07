import * as React from "react"
import { cn } from "@/utils/cn"
import { PickerInput } from "@/components/common/date-picker"

/**
 * Ô nhập (shadcn). `type="date"` / `type="month"` → bộ chọn tiếng Việt (date-picker.tsx) thay lịch của trình duyệt (hiện tiếng Anh);
 * value / onChange giữ dạng như input gốc (e.target.value = "yyyy-MM-dd" / "yyyy-MM").
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  if (type === "date" || type === "month") {
    const { id, value, onChange, min, max, required, disabled, name } = props
    return (
      <PickerInput kind={type === "month" ? "month" : "date"} id={id} value={typeof value === "string" ? value : ""} onChange={onChange}
        min={typeof min === "string" ? min : undefined} max={typeof max === "string" ? max : undefined}
        required={required} disabled={disabled} name={name} className={className}
        aria-label={props["aria-label"]} aria-invalid={props["aria-invalid"] as boolean | undefined} />
    )
  }
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
