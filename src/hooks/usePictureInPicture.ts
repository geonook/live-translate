import { useCallback, useState } from 'react'

interface DocumentPiP {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>
}

function getDocumentPiP(): DocumentPiP | null {
  return (
    (window as unknown as { documentPictureInPicture?: DocumentPiP })
      .documentPictureInPicture ?? null
  )
}

function copyStylesToPiP(target: Document): void {
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      const cssText = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n')
      const style = target.createElement('style')
      style.textContent = cssText
      target.head.appendChild(style)
    } catch {
      if (sheet.href) {
        const link = target.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        target.head.appendChild(link)
      }
    }
  })
}

export function usePictureInPicture() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const supported = getDocumentPiP() !== null

  const open = useCallback(async (width = 760, height = 240) => {
    const dpip = getDocumentPiP()
    if (!dpip) {
      throw new Error(
        '此瀏覽器不支援浮動字幕（Document Picture-in-Picture，需 Chrome/Edge 116+）',
      )
    }
    const win = await dpip.requestWindow({ width, height })
    copyStylesToPiP(win.document)
    win.document.documentElement.style.height = '100%'
    win.document.body.style.height = '100%'
    win.document.body.style.margin = '0'
    win.document.body.style.background = '#000'
    win.addEventListener('pagehide', () => setPipWindow(null))
    setPipWindow(win)
  }, [])

  const close = useCallback(() => {
    pipWindow?.close()
    setPipWindow(null)
  }, [pipWindow])

  return { pipWindow, open, close, supported }
}
