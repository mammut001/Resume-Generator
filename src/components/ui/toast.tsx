"use client"

import * as React from "react"
import { toast, Toaster } from "sonner"
import { getCurrentLocale, translate } from "@/i18n"

type ToastProps = {
  title?: string
  description?: string
  variant?: "default" | "destructive"
}

function ToasterComponent() {
  return <Toaster position="top-right" richColors />
}

export function useToast() {
  const show = React.useCallback(
    ({ title, description, variant = "default" }: ToastProps) => {
      if (variant === "destructive") {
        toast.error(title || translate(getCurrentLocale(), "common.error"), {
          description,
        })
      } else {
        toast.success(title || translate(getCurrentLocale(), "common.success"), {
          description,
        })
      }
    },
    []
  )

  return { toast: show }
}

export { ToasterComponent }