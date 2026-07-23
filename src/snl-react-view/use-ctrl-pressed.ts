import { useEffect, useState } from 'react'

/** Tracks Ctrl while this interaction surface is actively hovered. */
export function useCtrlPressed(enabled = true): boolean {
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setPressed(false)
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Control' || event.ctrlKey) setPressed(true)
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Control' || !event.ctrlKey) setPressed(false)
    }
    const onBlur = (): void => setPressed(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [enabled])

  return pressed
}
