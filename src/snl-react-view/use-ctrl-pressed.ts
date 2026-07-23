import { useEffect, useState } from 'react'

/** Tracks whether Ctrl is currently held, including press/release while stationary. */
export function useCtrlPressed(): boolean {
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
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
  }, [])

  return pressed
}
