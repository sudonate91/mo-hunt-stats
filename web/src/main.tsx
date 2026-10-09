import { render } from 'preact'
import './index.css'
import { App } from './app.tsx'
import { startDataLoading } from './state/data'
import { startUrlSync } from './state/filters'

startUrlSync()
startDataLoading()
render(<App />, document.getElementById('app')!)
