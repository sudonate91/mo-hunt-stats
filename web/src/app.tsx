import { lazy, Suspense } from 'preact/compat'
import { Shell, viewTitle } from './components/Shell'
import { ds, loadError } from './state/data'
import { view } from './state/filters'

const MapView = lazy(() => import('./views/MapView'))
const BoardView = lazy(() => import('./views/BoardView'))
const TrendsView = lazy(() => import('./views/TrendsView'))
const SeasonsView = lazy(() => import('./views/SeasonsView'))
const H2HView = lazy(() => import('./views/H2HView'))
const RecordsView = lazy(() => import('./views/RecordsView'))
const CountyView = lazy(() => import('./views/CountyView'))
const AboutView = lazy(() => import('./views/AboutView'))

function Skeleton() {
  return <div class="p-4 text-fg-3 animate-pulse">Loading…</div>
}

export function App() {
  const v = view.value
  let page
  switch (v) {
    case 'board': page = <BoardView />; break
    case 'trends': page = <TrendsView />; break
    case 'seasons': page = <SeasonsView />; break
    case 'h2h': page = <H2HView />; break
    case 'records': page = <RecordsView />; break
    case 'county': page = <CountyView />; break
    case 'about': page = <AboutView />; break
    default: page = <MapView />
  }
  return (
    <Shell title={viewTitle(v)}>
      {loadError.value && <div class="m-4 p-3 rounded bg-red-900/40 border border-red-700 text-sm">Could not load data: {loadError.value}</div>}
      {!ds.value && !loadError.value ? <Skeleton /> : <Suspense fallback={<Skeleton />}>{page}</Suspense>}
    </Shell>
  )
}
