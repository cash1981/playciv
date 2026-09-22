import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import './styles.css'
import { applyTheme, storedTheme } from './theme.js'
import { SiteBackdrop } from './views/SiteBackdrop.js'

// Set the saved palette before React mounts, avoiding a dark-theme flash.
applyTheme(storedTheme())

const container = document.getElementById('root')
if (container === null) throw new Error('Could not find #root')

createRoot(container).render(
  <StrictMode>
    <SiteBackdrop />
    <App />
  </StrictMode>,
)
