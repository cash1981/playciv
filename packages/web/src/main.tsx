import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import './styles.css'

const container = document.getElementById('root')
if (container === null) throw new Error('Could not find #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
