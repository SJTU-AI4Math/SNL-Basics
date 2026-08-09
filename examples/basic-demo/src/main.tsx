import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import 'katex/dist/katex.min.css'
import '@sjtu-ai4math/snl-basics/entry/style.css'
import './style.css'

import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
